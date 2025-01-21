import json
from typing import Literal

from pydantic import BaseModel


class ConfigDownloadFile(BaseModel):
    url: str
    path: str


class ConfigDownloadParameters(BaseModel):
    files: list[ConfigDownloadFile]


class ConfigDownload(BaseModel):
    type: Literal["download"]
    parameters: ConfigDownloadParameters


class ConfigLaunchParameters(BaseModel):
    command: list[str]


class ConfigLaunch(BaseModel):
    type: Literal["launch"]
    parameters: ConfigLaunchParameters


class ConfigNYI(BaseModel):
    type: Literal["execute", "sleep"]
    # ...


Config = ConfigDownload | ConfigLaunch | ConfigNYI


class EvaluatorVMFile(BaseModel):
    type: Literal["vm_file"]
    path: str
    dest: str


class EvaluatorExpectedRule(BaseModel):
    type: Literal["rule"]
    # ...


EvaluatorExpected = EvaluatorVMFile | EvaluatorExpectedRule


class ResultNYI(BaseModel):
    type: Literal["gimp_config_file"]


EvaluatorResult = EvaluatorVMFile | ResultNYI


class Evaluator(BaseModel):
    postconfig: list[Config] | None = None
    func: str | list[str]
    expected: EvaluatorExpected | list[EvaluatorExpected] | None = None
    result: EvaluatorResult | list[EvaluatorResult] | None = None


class Example(BaseModel):
    id: str
    snapshot: str
    source: str
    instruction: str
    config: list[Config]
    evaluator: Evaluator


def example_from_file(file_path: str) -> Example | None:
    with open(file_path, "r") as file:
        data = file.read()
        try:
            return Example(**json.loads(data))
        except json.JSONDecodeError:
            return None
