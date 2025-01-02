import asyncio
import base64
import json
import logging
import os
import uuid

from pydantic import BaseModel, Field

from inspect_ai._util.content import ContentText
from inspect_ai.model import Content, ContentImage
from inspect_ai.tool._tool import ToolError
from inspect_ai.tool._tools._computer._mock_logger import MockLogger
from inspect_ai.util import sandbox

# log = logging.getLogger(__name__)
log = MockLogger()
log.setLevel(logging.DEBUG)


# TODO: Export ToolResult from inspect_ai.tool
ToolResult = str | int | float | bool | list[Content]


class ShellExecSuccessResult(BaseModel):
    output: str | None = Field(default=None)
    base64_image: str | None = Field(default=None)


hackIsFirstCommand = True


async def _send_cmd(cmdTail: list[str]) -> ToolResult:
    # TODO: Resolve this issue
    # without this delay, the first attempt to take a screenshot
    # happens too soon before the GUI has actually rendered.
    global hackIsFirstCommand
    if hackIsFirstCommand:
        stallResult = await sandbox().exec(["ls"])
        if not stallResult.success:
            log.error(f"First sandbox().exec() failed with: {stallResult.stderr}")
            raise ToolError(f"Error executing command: {stallResult.stderr}")
        log.debug("First sandbox().exec() succeeded...sleeping")
        await asyncio.sleep(20)
        log.debug("Stall done")
        hackIsFirstCommand = False

    cmd = ["python", "computer_tool_support/cli.py", "--action"] + cmdTail
    log.debug(f"Executing command: {cmd}")

    try:
        raw_exec_result = await sandbox().exec(cmd)

        # with open(f"{cmd[3]}_result.txt", "w") as file:
        #   file.write(raw_exec_result.stdout)

        if not raw_exec_result.success:
            log.error(f"Execution failed with: {raw_exec_result.stderr[:50]}...")
            raise ToolError(f"Error executing command: ${cmd} {raw_exec_result.stderr}")

        result = ShellExecSuccessResult(**json.loads(raw_exec_result.stdout))

        # TODO: Remove this code
        # save the image to a file for debugging
        if result.base64_image:
            random_filename = f"{uuid.uuid4()}.png"
            output_path = os.path.join("/tmp/output", random_filename)

            # Decode the base64 image and save it to the file
            with open(output_path, "wb") as image_file:
                image_file.write(base64.b64decode(result.base64_image))

        image = (
            ContentImage(image=f"data:image/png;base64,{result.base64_image}")
            if result.base64_image
            else None
        )
        text = result.output if result.output and len(result.output) > 0 else None

        if text is not None and image is not None:
            log.debug(f"ToolResult([ContentText('{text}'), ContentImage])")
            return [ContentText(text=text), image]

        if text is not None:
            log.debug(f"ToolResult('{text}')")
            return text

        if image is not None:
            log.debug("ToolResult([ContentImage])")
            return [image]

        log.debug("Tool returned neither output nor image - returning ToolResult('OK')")
        return "OK"
    except Exception as e:
        log.error(f"Sandbox.exec threw for {cmd}...re-raising")
        raise e


async def cursor_position() -> str:
    # TODO: Code me
    return "100 100"


async def screenshot() -> ToolResult:
    return await _send_cmd(["screenshot"])


async def mouse_move(x: int, y: int) -> ToolResult:
    return await _send_cmd(["mouse_move", "--coordinate", f"{x}", f"{y}"])


async def left_click() -> ToolResult:
    return await _send_cmd(["left_click"])


async def left_click_drag(x: int, y: int) -> ToolResult:
    return await _send_cmd(["left_click_drag", "--coordinate", f"{x}", f"{y}"])


async def right_click() -> ToolResult:
    return await _send_cmd(["right_click"])


async def middle_click() -> ToolResult:
    return await _send_cmd(["middle_click"])


async def double_click() -> ToolResult:
    return await _send_cmd(["double_click"])


async def press_key(key: str) -> ToolResult:
    # TODO: Temporary partial fix for lack of escaping of user input
    # When the model wants to key "*", it turns into a command line
    # ending in "-- *", which expands to a list of all files and folders
    # and hilarity ensues
    if key == "*":
        key = "KP_Multiply"
    res = await _send_cmd(["key", "--text", key])
    return res


async def type(text: str) -> ToolResult:
    return await _send_cmd(["type", "--text", text])
