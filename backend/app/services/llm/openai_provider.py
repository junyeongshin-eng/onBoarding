"""
OpenAI LLM Provider 구현
GPT-4o, GPT-4o-mini 등 지원
"""
import json
from typing import Optional
from openai import AsyncOpenAI
from .base import LLMProvider, LLMResponse, LLMConfig


class OpenAIProvider(LLMProvider):
    """OpenAI API Provider"""

    def __init__(self, api_key: str, config: Optional[LLMConfig] = None):
        super().__init__(api_key, config)
        self.client = AsyncOpenAI(api_key=api_key)

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        json_schema: Optional[dict] = None,
    ) -> LLMResponse:
        """OpenAI 완성 요청"""
        try:
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]

            kwargs = {
                "model": self.config.model,
                "messages": messages,
                "temperature": self.config.temperature,
                "max_tokens": self.config.max_tokens,
            }

            # JSON 모드 설정
            if self.config.json_mode:
                kwargs["response_format"] = {"type": "json_object"}

            response = await self.client.chat.completions.create(**kwargs)

            content = response.choices[0].message.content or ""

            # 추론 과정 추출
            thinking, clean_content = self.extract_thinking(content)

            # JSON 파싱
            parsed_json = self.extract_json_from_response(clean_content)

            return LLMResponse(
                success=True,
                content=content,
                parsed_json=parsed_json,
                thinking=thinking,
                model=response.model,
                usage={
                    "prompt_tokens": response.usage.prompt_tokens if response.usage else 0,
                    "completion_tokens": response.usage.completion_tokens if response.usage else 0,
                    "total_tokens": response.usage.total_tokens if response.usage else 0,
                }
            )

        except Exception as e:
            return LLMResponse(
                success=False,
                content="",
                error=str(e),
            )

    async def complete_with_repair(
        self,
        system_prompt: str,
        user_prompt: str,
        validation_errors: list[str],
        original_response: str,
    ) -> LLMResponse:
        """검증 오류 수정 요청"""
        repair_prompt = self._build_repair_prompt(
            original_response,
            validation_errors,
        )

        return await self.complete(
            system_prompt=system_prompt,
            user_prompt=f"{user_prompt}\n\n---\n\n{repair_prompt}",
        )

    def _build_repair_prompt(
        self,
        original_response: str,
        validation_errors: list[str],
    ) -> str:
        """수정 요청 프롬프트 생성"""
        errors_text = "\n".join(f"- {e}" for e in validation_errors)

        return f"""
## 수정 요청

이전 응답에서 다음 오류가 발견되었습니다:

{errors_text}

### 이전 응답:
```json
{original_response}
```

위 오류를 수정하여 올바른 JSON을 다시 생성해주세요.
모든 필드 라벨은 반드시 "오브젝트 - 필드명" 형식을 따라야 합니다.
"""
