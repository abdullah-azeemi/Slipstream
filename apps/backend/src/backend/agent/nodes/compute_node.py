from __future__ import annotations
import subprocess
import sys
import tempfile
import textwrap
from dataclasses import dataclass
from backend.agent import llm as llm_client

SYSTEM_PROMPT = (
    "You are an F1 Data Analyst. Write a secure Pandas script to answer the query "
    "using the provided data. You must only print the final statistical result to "
    "standard output. Do not include markdown formatting or markdown code blocks in "
    "your response — output pure Python code only."
)

TIMEOUT_SECONDS = 10

@dataclass
class ComputeInput:
    query: str
    data_csv: str
    error_feedback: str = ""

@dataclass
class ComputeOutput:
    script: str
    result: str
    success: bool

def run(inp: ComputeInput) -> ComputeOutput:
    """ Generate and execute the pandas script to answer the query """
    prompt = _build_prompt(inp)
    script = llm_client.complete(prompt, system=SYSTEM_PROMPT)
    result, success = _execute(script, inp.data_csv)

    return ComputeOutput(script=script, result=result, success=success)

def _build_prompt(inp: ComputeInput) -> str:
    parts = [
        f"Query : {inp.query}",
        "",
        "The CSV data is already loaded into a pandas DataFrame called `df`.",
        "Write a Python script using `df` to answer the query. Print only the answer.",
    ]
    if inp.error_feedback:
        parts +=  ["", f"PREVIOUS ERROR — fix this: {inp.error_feedback}"]
    return "\n".join(parts)

def _execute(script: str, data_csv: str) -> tuple[str, bool]:
    """ Run the script in the subprocess with the CSV preloaded as 'df' """
    wrapper = "\n".join([
        "import pandas as pd, io",
        f'_csv = """{data_csv}"""',
        "df = pd.read_csv(io.StringIO(_csv.strip()))",
        textwrap.dedent(script),
        "",
    ])

    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(wrapper)
        tmp_path = f.name

    try:
        proc = subprocess.run(
            [sys.executable, tmp_path],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
        )
        if proc.returncode != 0:
            return f"Script error: {proc.stderr[:500]}", False
        return proc.stdout.strip(), True
    except subprocess.TimeoutExpired:
        return "Error: script exceeded 10-second timeout.", False
    except Exception as e:
        return f"Execution error: {e}", False