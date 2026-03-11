"""
Bulk Import Service
Rate-limited, concurrent row processing with SSE streaming for Salesmap API.
"""
import asyncio
import json
import time
from typing import Any, AsyncGenerator, Optional

import httpx

from app.services.import_history_service import (
    create_session,
    log_row_result_async,
    flush_log_buffer,
    end_session,
)

SALESMAP_API_BASE = "https://salesmap.kr/api"


class SlidingWindowRateLimiter:
    """Sliding window rate limiter for Salesmap API (100 req/10s limit, use 85 for safety)."""

    def __init__(self, max_requests: int = 85, window_seconds: float = 10.0):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._timestamps: list[float] = []
        self._lock = asyncio.Lock()

    async def acquire(self):
        while True:
            async with self._lock:
                now = time.monotonic()
                # Remove expired timestamps
                cutoff = now - self.window_seconds
                self._timestamps = [t for t in self._timestamps if t > cutoff]

                if len(self._timestamps) < self.max_requests:
                    self._timestamps.append(now)
                    return
                # Calculate wait time until oldest timestamp expires
                wait_time = self._timestamps[0] - cutoff + 0.05
            await asyncio.sleep(wait_time)


async def call_salesmap_api(
    client: httpx.AsyncClient,
    rate_limiter: SlidingWindowRateLimiter,
    api_key: str,
    endpoint: str,
    body: dict[str, Any],
    session_id: Optional[str] = None,
    row_index: Optional[int] = None,
    object_type: Optional[str] = None,
    action: str = "create",
) -> dict[str, Any]:
    """Call Salesmap API with rate limiting and session logging."""
    await rate_limiter.acquire()

    try:
        response = await client.request(
            method="POST",
            url=f"{SALESMAP_API_BASE}{endpoint}",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=30.0,
        )

        result = response.json()

        raw_reason = result.get("reason")
        reason_str = ", ".join(raw_reason) if isinstance(raw_reason, list) else raw_reason

        if response.status_code in (200, 201):
            api_result = {
                "success": result.get("success", True),
                "data": result.get("data"),
                "message": result.get("message"),
                "reason": reason_str,
            }
        else:
            api_result = {
                "success": False,
                "data": result.get("data"),
                "message": result.get("message", f"API error: {response.status_code}"),
                "reason": reason_str,
            }

        # Session logging (non-blocking, batched)
        if session_id and row_index is not None and object_type:
            try:
                await log_row_result_async(
                    session_id=session_id,
                    row_index=row_index,
                    object_type=object_type,
                    request_body=body,
                    response_body=result,
                    success=api_result["success"],
                    error_message=(api_result["reason"] or api_result["message"]) if not api_result["success"] else None,
                    action=action,
                )
            except Exception as log_err:
                print(f"[BulkImport] Logging error (non-fatal): {log_err}")

        return api_result

    except httpx.TimeoutException:
        error_result = {"success": False, "data": None, "message": "API timeout", "reason": None}
        if session_id and row_index is not None and object_type:
            try:
                await log_row_result_async(session_id, row_index, object_type, body, {}, False, "API timeout", action=action)
            except Exception:
                pass
        return error_result
    except Exception as e:
        error_result = {"success": False, "data": None, "message": str(e), "reason": None}
        if session_id and row_index is not None and object_type:
            try:
                await log_row_result_async(session_id, row_index, object_type, body, {}, False, str(e), action=action)
            except Exception:
                pass
        return error_result


async def _create_or_upsert(
    client: httpx.AsyncClient,
    rate_limiter: SlidingWindowRateLimiter,
    api_key: str,
    object_type: str,
    body: dict[str, Any],
    upsert_enabled: bool,
    session_id: Optional[str],
    row_index: int,
) -> dict[str, Any]:
    """Create an object; if duplicate and upsert enabled, update it."""
    endpoint = f"/v2/{object_type}"
    result = await call_salesmap_api(
        client, rate_limiter, api_key, endpoint,
        body, session_id, row_index, object_type, "create",
    )

    # Duplicate handling: API returns success=False but provides existing ID
    if not result["success"] and result.get("data") and result["data"].get("id"):
        duplicate_id = result["data"]["id"]

        if not upsert_enabled:
            # Return failure but keep the ID for cascading connections
            return {**result, "wasUpdated": False}

        # Upsert: try updating the existing record
        update_result = await call_salesmap_api(
            client, rate_limiter, api_key, f"{endpoint}/{duplicate_id}",
            body, session_id, row_index, object_type, "update",
        )

        if update_result["success"]:
            return {
                **update_result,
                "data": {**(update_result.get("data") or {}), "id": duplicate_id},
                "wasUpdated": True,
            }
        # Update also failed - return with the duplicate ID
        return {**update_result, "data": {"id": duplicate_id}, "wasUpdated": False}

    return result


async def process_row(
    row_index: int,
    row_data: dict[str, Any],
    client: httpx.AsyncClient,
    rate_limiter: SlidingWindowRateLimiter,
    api_key: str,
    upsert_enabled: bool,
    session_id: Optional[str],
    active_objects: list[str],
    product_cache: list[dict],
    product_in_flight: dict[str, asyncio.Future],
    product_lock: asyncio.Lock,
    quote_connection: str,
    results_map: dict[str, dict],
    results_lock: asyncio.Lock,
) -> None:
    """Process a single row: cascade create org → people → deal/lead → product → quote."""

    organization_id: Optional[str] = None
    people_id: Optional[str] = None
    deal_id: Optional[str] = None
    lead_id: Optional[str] = None
    product_id: Optional[str] = None

    async def record_result(obj_type: str, status: str, error_msg: Optional[str] = None):
        async with results_lock:
            if status == "success":
                results_map[obj_type]["success"] += 1
            elif status == "updated":
                results_map[obj_type]["updated"] += 1
            elif status == "skipped":
                results_map[obj_type]["skipped"] += 1
            elif status == "failed":
                results_map[obj_type]["failed"] += 1
                if error_msg:
                    results_map[obj_type]["errors"].append({
                        "row": row_index + 1,
                        "message": error_msg,
                    })

    # 1. Organization
    if "organization" in active_objects and row_data.get("organization"):
        try:
            body = row_data["organization"]
            result = await _create_or_upsert(
                client, rate_limiter, api_key, "organization",
                body, upsert_enabled, session_id, row_index,
            )
            if result["success"]:
                data = result.get("data") or {}
                organization_id = data.get("organization", {}).get("id") or data.get("id")
                await record_result("organization", "updated" if result.get("wasUpdated") else "success")
            else:
                if (result.get("data") or {}).get("id"):
                    organization_id = result["data"]["id"]
                await record_result("organization", "failed", result.get("reason") or result.get("message") or "creation failed")
        except Exception as e:
            await record_result("organization", "failed", str(e))

    # 2. People (inject organizationId)
    if "people" in active_objects and row_data.get("people"):
        try:
            body_inner = {**row_data["people"]}
            if organization_id:
                body_inner["organizationId"] = organization_id

            result = await _create_or_upsert(
                client, rate_limiter, api_key, "people",
                body_inner, upsert_enabled, session_id, row_index,
            )
            if result["success"]:
                data = result.get("data") or {}
                people_id = data.get("people", {}).get("id") or data.get("id")
                await record_result("people", "updated" if result.get("wasUpdated") else "success")
            else:
                if (result.get("data") or {}).get("id"):
                    people_id = result["data"]["id"]
                await record_result("people", "failed", result.get("reason") or result.get("message") or "creation failed")
        except Exception as e:
            await record_result("people", "failed", str(e))

    # 3. Deal (inject organizationId + peopleId)
    if "deal" in active_objects and row_data.get("deal"):
        try:
            body_inner = {**row_data["deal"]}
            if organization_id:
                body_inner["organizationId"] = organization_id
            if people_id:
                body_inner["peopleId"] = people_id

            result = await _create_or_upsert(
                client, rate_limiter, api_key, "deal",
                body_inner, upsert_enabled, session_id, row_index,
            )
            if result["success"]:
                data = result.get("data") or {}
                deal_id = data.get("deal", {}).get("id") or data.get("id")
                await record_result("deal", "updated" if result.get("wasUpdated") else "success")
            else:
                if (result.get("data") or {}).get("id"):
                    deal_id = result["data"]["id"]
                await record_result("deal", "failed", result.get("reason") or result.get("message") or "creation failed")
        except Exception as e:
            await record_result("deal", "failed", str(e))

    # 4. Lead (inject organizationId + peopleId)
    if "lead" in active_objects and row_data.get("lead"):
        try:
            body_inner = {**row_data["lead"]}
            if organization_id:
                body_inner["organizationId"] = organization_id
            if people_id:
                body_inner["peopleId"] = people_id

            result = await _create_or_upsert(
                client, rate_limiter, api_key, "lead",
                body_inner, upsert_enabled, session_id, row_index,
            )
            if result["success"]:
                data = result.get("data") or {}
                lead_id = data.get("lead", {}).get("id") or data.get("id")
                await record_result("lead", "updated" if result.get("wasUpdated") else "success")
            else:
                if (result.get("data") or {}).get("id"):
                    lead_id = result["data"]["id"]
                await record_result("lead", "failed", result.get("reason") or result.get("message") or "creation failed")
        except Exception as e:
            await record_result("lead", "failed", str(e))

    # 5. Product (cache + in-flight dedup)
    if "product" in active_objects and row_data.get("product"):
        try:
            prod_data = row_data["product"]
            prod_name = prod_data.get("name", "")

            if not prod_name:
                await record_result("product", "failed", "product name is empty")
            else:
                name_key = prod_name.strip().lower()

                # Check cache first
                existing = next((p for p in product_cache if p["name"].strip().lower() == name_key), None)
                if existing:
                    product_id = existing["id"]
                    await record_result("product", "skipped")
                else:
                    # Check in-flight
                    async with product_lock:
                        if name_key in product_in_flight:
                            fut = product_in_flight[name_key]
                        else:
                            fut = asyncio.get_event_loop().create_future()
                            product_in_flight[name_key] = fut
                            fut = None  # Signal: we are the creator

                    if fut is not None:
                        # Wait for another row creating same product
                        product_id = await product_in_flight[name_key]
                        if product_id:
                            await record_result("product", "skipped")
                        else:
                            await record_result("product", "failed", "concurrent product creation failed")
                    else:
                        # We are the creator
                        created_id = None
                        try:
                            result = await call_salesmap_api(
                                client, rate_limiter, api_key, "/v2/product",
                                prod_data, session_id, row_index, "product", "create",
                            )
                            if result["success"] and result.get("data"):
                                data = result["data"]
                                created_id = data.get("product", {}).get("id") or data.get("id")
                                if created_id:
                                    product_cache.append({
                                        "id": created_id,
                                        "name": prod_name,
                                        "price": prod_data.get("price", 0),
                                    })
                        finally:
                            async with product_lock:
                                future = product_in_flight[name_key]
                                future.set_result(created_id)

                        product_id = created_id
                        if product_id:
                            await record_result("product", "success")
                        else:
                            await record_result("product", "failed", "product creation failed")
        except Exception as e:
            await record_result("product", "failed", str(e))

    # 6. Quote (needs deal/lead + product)
    if "quote" in active_objects and row_data.get("quote"):
        try:
            conn_id = None
            if quote_connection == "deal":
                conn_id = deal_id or lead_id
            else:
                conn_id = lead_id or deal_id

            if not conn_id:
                await record_result("quote", "failed", "no deal/lead to connect")
            elif not product_id:
                await record_result("quote", "failed", "no product to connect")
            else:
                quote_data = {**row_data["quote"]}

                # Set deal/lead connection
                if quote_connection == "deal" and deal_id:
                    quote_data["dealId"] = deal_id
                elif quote_connection == "lead" and lead_id:
                    quote_data["leadId"] = lead_id
                elif deal_id:
                    quote_data["dealId"] = deal_id
                elif lead_id:
                    quote_data["leadId"] = lead_id

                # Build quoteProductList from temporary fields
                quote_amount = quote_data.pop("__quoteAmount", 1) or 1
                payment_count = quote_data.pop("__paymentCount", None)
                payment_start_at = quote_data.pop("__paymentStartAt", None)

                # Find product info from cache
                prod_info = next((p for p in product_cache if p["id"] == product_id), None)
                quote_product: dict[str, Any] = {
                    "name": prod_info["name"] if prod_info else "",
                    "productId": product_id,
                    "price": prod_info["price"] if prod_info else 0,
                    "amount": quote_amount,
                }
                if payment_count:
                    quote_product["paymentCount"] = payment_count
                if payment_start_at:
                    quote_product["paymentStartAt"] = payment_start_at

                quote_data["quoteProductList"] = [quote_product]

                result = await call_salesmap_api(
                    client, rate_limiter, api_key, "/v2/quote",
                    quote_data, session_id, row_index, "quote", "create",
                )

                if result["success"]:
                    await record_result("quote", "success")
                else:
                    await record_result("quote", "failed", result.get("reason") or result.get("message") or "quote creation failed")
        except Exception as e:
            await record_result("quote", "failed", str(e))


async def bulk_import_stream(
    api_key: str,
    upsert_enabled: bool,
    session_id: Optional[str],
    active_objects: list[str],
    product_cache_initial: list[dict],
    quote_connection: str,
    rows: list[dict[str, Any]],
) -> AsyncGenerator[str, None]:
    """SSE stream generator for bulk import."""

    total = len(rows)
    completed = 0
    completed_lock = asyncio.Lock()

    results_map: dict[str, dict] = {}
    results_lock = asyncio.Lock()
    for obj_type in active_objects:
        results_map[obj_type] = {
            "success": 0, "updated": 0, "failed": 0, "skipped": 0, "errors": [],
        }

    product_cache = list(product_cache_initial)
    product_in_flight: dict[str, asyncio.Future] = {}
    product_lock = asyncio.Lock()

    semaphore = asyncio.Semaphore(10)
    rate_limiter = SlidingWindowRateLimiter(85, 10.0)

    async def process_row_wrapper(i: int):
        nonlocal completed
        async with semaphore:
            await process_row(
                row_index=i,
                row_data=rows[i],
                client=client,
                rate_limiter=rate_limiter,
                api_key=api_key,
                upsert_enabled=upsert_enabled,
                session_id=session_id,
                active_objects=active_objects,
                product_cache=product_cache,
                product_in_flight=product_in_flight,
                product_lock=product_lock,
                quote_connection=quote_connection,
                results_map=results_map,
                results_lock=results_lock,
            )
        async with completed_lock:
            completed += 1

    async with httpx.AsyncClient(timeout=30.0) as client:
        tasks = [asyncio.create_task(process_row_wrapper(i)) for i in range(total)]

        # Progress polling loop
        while True:
            await asyncio.sleep(0.3)
            async with completed_lock:
                current = completed

            percent = round((current / total) * 100) if total > 0 else 100
            progress_data = json.dumps({
                "completed": current,
                "total": total,
                "percent": percent,
            })
            yield f"event: progress\ndata: {progress_data}\n\n"

            if current >= total:
                break

        # Wait for all tasks to finish (should already be done)
        await asyncio.gather(*tasks, return_exceptions=True)

    # Flush remaining log buffer
    try:
        await flush_log_buffer()
    except Exception as e:
        print(f"[BulkImport] Final log flush error (non-fatal): {e}")

    # End session
    if session_id:
        try:
            await asyncio.to_thread(end_session, session_id)
        except Exception as e:
            print(f"[BulkImport] Session end error (non-fatal): {e}")

    # Emit complete event
    complete_data = json.dumps({"results": results_map})
    yield f"event: complete\ndata: {complete_data}\n\n"
