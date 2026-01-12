"""
File Analyzer 서비스
업로드된 파일 분석 및 컬럼 통계 생성
"""
from typing import Optional
from dataclasses import dataclass
import re

from app.models.schemas import ColumnStats
from app.models.salesmap import SKIP_COLUMN_PATTERNS, EMPTY_VALUES, is_value_empty


@dataclass
class AnalysisResult:
    """파일 분석 결과"""
    columns: list[str]
    total_rows: int
    column_stats: list[ColumnStats]
    sample_data: list[dict]


class FileAnalyzer:
    """파일 분석기"""

    def analyze(
        self,
        data: list[dict],
        sample_count: int = 5,
    ) -> AnalysisResult:
        """
        데이터 분석

        Args:
            data: 파일 데이터 (dict 리스트)
            sample_count: 샘플 데이터 수

        Returns:
            AnalysisResult
        """
        if not data:
            return AnalysisResult(
                columns=[],
                total_rows=0,
                column_stats=[],
                sample_data=[],
            )

        # 컬럼 추출
        columns = list(data[0].keys()) if data else []
        total_rows = len(data)

        # 컬럼별 통계 계산
        column_stats = []
        for col in columns:
            stats = self._analyze_column(data, col)
            column_stats.append(stats)

        # 샘플 데이터
        sample_data = data[:sample_count]

        return AnalysisResult(
            columns=columns,
            total_rows=total_rows,
            column_stats=column_stats,
            sample_data=sample_data,
        )

    def _analyze_column(self, data: list[dict], column: str) -> ColumnStats:
        """단일 컬럼 분석"""
        values = [row.get(column) for row in data]
        total = len(values)

        # 빈 값 계산
        empty_count = sum(1 for v in values if is_value_empty(v))
        non_empty_count = total - empty_count

        # 유니크 값 계산 (빈 값 제외)
        non_empty_values = [str(v).strip() for v in values if not is_value_empty(v)]
        unique_count = len(set(non_empty_values))

        # 샘플 값 (처음 5개 비어있지 않은 값)
        sample_values = []
        seen = set()
        for v in non_empty_values:
            if v not in seen and len(sample_values) < 5:
                sample_values.append(v)
                seen.add(v)

        return ColumnStats(
            column_name=column,
            total_rows=total,
            non_empty_count=non_empty_count,
            empty_count=empty_count,
            unique_count=unique_count,
            sample_values=sample_values,
        )

    def detect_column_type(self, stats: ColumnStats) -> str:
        """
        컬럼 데이터 타입 추론

        Returns:
            추론된 필드 타입 (text, email, phone, number, date, url, ...)
        """
        samples = stats.sample_values
        if not samples:
            return "text"

        # 패턴 매칭
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        phone_pattern = r'^[\d\-\+\(\)\s]{8,}$'
        url_pattern = r'^https?://[^\s]+'
        date_pattern = r'^\d{4}[-/]\d{2}[-/]\d{2}'
        number_pattern = r'^-?\d+\.?\d*$'

        type_counts = {
            "email": 0,
            "phone": 0,
            "url": 0,
            "date": 0,
            "number": 0,
            "text": 0,
        }

        for sample in samples:
            s = str(sample).strip()
            if re.match(email_pattern, s):
                type_counts["email"] += 1
            elif re.match(url_pattern, s):
                type_counts["url"] += 1
            elif re.match(date_pattern, s):
                type_counts["date"] += 1
            elif re.match(number_pattern, s.replace(',', '').replace(' ', '')):
                type_counts["number"] += 1
            elif re.match(phone_pattern, s):
                type_counts["phone"] += 1
            else:
                type_counts["text"] += 1

        # 가장 많은 타입 반환 (동점이면 text)
        max_type = max(type_counts.items(), key=lambda x: (x[1], x[0] == "text"))
        return max_type[0] if max_type[1] > 0 else "text"

    def is_skip_candidate(self, stats: ColumnStats) -> tuple[bool, Optional[str]]:
        """
        제외 후보인지 확인

        Returns:
            (is_skip, reason): 제외 여부와 사유
        """
        column = stats.column_name.lower()

        # 1. 내부 식별자 패턴 확인
        for pattern in SKIP_COLUMN_PATTERNS:
            if re.match(pattern, column, re.IGNORECASE):
                return True, "내부 식별자"

        # 2. 빈 값만 있는지 확인
        if stats.non_empty_count == 0:
            return True, "빈 값만 있음"

        # 3. 값이 너무 적은 경우 (5% 미만)
        fill_rate = stats.non_empty_count / stats.total_rows if stats.total_rows > 0 else 0
        if fill_rate < 0.05:
            return True, "빈 값만 있음"

        return False, None

    def detect_duplicates(
        self,
        column_stats: list[ColumnStats],
    ) -> list[tuple[str, str]]:
        """
        중복 컬럼 감지

        Returns:
            중복 쌍 목록 [(col1, col2), ...]
        """
        duplicates = []
        n = len(column_stats)

        for i in range(n):
            for j in range(i + 1, n):
                stats_i = column_stats[i]
                stats_j = column_stats[j]

                # 샘플 값이 완전히 동일하면 중복
                if (stats_i.sample_values and stats_j.sample_values and
                    stats_i.sample_values == stats_j.sample_values):
                    duplicates.append((stats_i.column_name, stats_j.column_name))

        return duplicates


# 싱글톤 인스턴스
file_analyzer = FileAnalyzer()
