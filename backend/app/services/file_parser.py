import pandas as pd
from io import BytesIO


def parse_file(contents: bytes, file_ext: str) -> dict:
    """Parse CSV or Excel file and return columns with preview data"""

    buffer = BytesIO(contents)

    if file_ext == ".csv":
        df = pd.read_csv(buffer)
    elif file_ext in [".xlsx", ".xls"]:
        df = pd.read_excel(buffer)
    else:
        raise ValueError(f"Unsupported file type: {file_ext}")

    df = df.fillna("")

    columns = df.columns.tolist()
    preview = df.head(5).to_dict(orient="records")
    total_rows = len(df)

    return {
        "columns": columns,
        "preview": preview,
        "total_rows": total_rows,
        "data": df.to_dict(orient="records")
    }
