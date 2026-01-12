"""
LLM Provider 추상 기본 클래스
새로운 LLM 제공자 추가 시 이 클래스를 상속
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Any
import json
import re


@dataclass
class LLMResponse:
    """LLM 응답 결과"""
    success: bool
    content: str  # 원본 응답 텍스트
    parsed_json: Optional[dict] = None  # 파싱된 JSON
    thinking: Optional[str] = None  # 추론 과정 (CoT)
    model: str = ""
    usage: dict = field(default_factory=dict)  # 토큰 사용량
    error: Optional[str] = None

    @property
    def json(self) -> Optional[dict]:
        """JSON 응답 반환"""
        return self.parsed_json


@dataclass
class LLMConfig:
    """LLM 설정"""
    model: str = "gpt-4o-mini"
    temperature: float = 0.3
    max_tokens: int = 4000
    timeout: int = 60
    retry_count: int = 2
    json_mode: bool = True  # JSON 응답 강제


class LLMProvider(ABC):
    """LLM 제공자 추상 클래스"""

    def __init__(self, api_key: str, config: Optional[LLMConfig] = None):
        self.api_key = api_key
        self.config = config or LLMConfig()

    @abstractmethod
    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        json_schema: Optional[dict] = None,
    ) -> LLMResponse:
        """
        LLM 완성 요청

        Args:
            system_prompt: 시스템 프롬프트
            user_prompt: 사용자 프롬프트
            json_schema: JSON 스키마 (선택적 - 응답 형식 강제용)

        Returns:
            LLMResponse: 응답 결과
        """
        pass

    @abstractmethod
    async def complete_with_repair(
        self,
        system_prompt: str,
        user_prompt: str,
        validation_errors: list[str],
        original_response: str,
    ) -> LLMResponse:
        """
        검증 오류 수정 요청 (Repair Loop)

        Args:
            system_prompt: 원본 시스템 프롬프트
            user_prompt: 원본 사용자 프롬프트
            validation_errors: 검증 오류 목록
            original_response: 원본 응답

        Returns:
            LLMResponse: 수정된 응답
        """
        pass

    def extract_json_from_response(self, text: str) -> Optional[dict]:
        """
        응답 텍스트에서 JSON 추출
        마크다운 코드 블록도 처리
        """
        # 마크다운 JSON 코드 블록 추출
        json_block_pattern = r'```(?:json)?\s*([\s\S]*?)```'
        matches = re.findall(json_block_pattern, text)

        if matches:
            for match in matches:
                try:
                    return json.loads(match.strip())
                except json.JSONDecodeError:
                    continue

        # 직접 JSON 파싱 시도
        try:
            return json.loads(text.strip())
        except json.JSONDecodeError:
            pass

        # JSON 객체 패턴으로 추출 시도
        json_pattern = r'\{[\s\S]*\}'
        match = re.search(json_pattern, text)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass

        return None

    def extract_thinking(self, text: str) -> tuple[Optional[str], str]:
        """
        CoT 추론 과정 추출

        Returns:
            (thinking, content): 추론 과정과 실제 내용
        """
        # <thinking>...</thinking> 태그 추출
        thinking_pattern = r'<thinking>([\s\S]*?)</thinking>'
        match = re.search(thinking_pattern, text)

        if match:
            thinking = match.group(1).strip()
            content = re.sub(thinking_pattern, '', text).strip()
            return thinking, content

        # thinking 필드가 JSON에 포함된 경우
        json_data = self.extract_json_from_response(text)
        if json_data and 'thinking' in json_data:
            thinking = json_data.pop('thinking')
            return thinking, json.dumps(json_data, ensure_ascii=False)

        return None, text
