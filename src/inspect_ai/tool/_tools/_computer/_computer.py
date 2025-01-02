from typing import Awaitable, Callable

from inspect_ai.model import Content
from inspect_ai.tool import Tool, tool
from inspect_ai.tool._tool import ToolParsingError

from . import _computer_common as common
from ._action import Action

# Export ToolResult from inspect_ai.tool
ToolResult = str | int | float | bool | list[Content]

ActionFunction = Callable[[str], ToolResult | Awaitable[ToolResult]]


@tool(parallel=False)
def computer(timeout: int | None = None) -> Tool:
    """
    Computer interaction tool.

    Args:
      timeout (int | None): Timeout (in seconds) for command.

    Returns:
      Computer interaction tool.
    """

    async def execute(
        action: Action,
        text: str | None = None,
        coordinate: tuple[int, int] | None = None,
    ) -> ToolResult:
        """
        Use this tool to interact with the computer.

        Args:
          action (Action): The action to perform.
          text (str | None): The text to type or the key to press. Required when action is "key" or "type".
          coordinate (tuple[int, int] | None): The (x, y) pixel coordinate on the screen to which to move or drag. Required when action is "mouse_move" or "left_click_drag".

        """
        try:
            if action in ("mouse_move", "left_click_drag"):
                if coordinate is None:
                    raise ToolParsingError(f"coordinate is required for {action}")
                if text is not None:
                    raise ToolParsingError(f"text is not accepted for {action}")
                if not isinstance(coordinate, list) or len(coordinate) != 2:
                    raise ToolParsingError(f"{coordinate} must be a tuple of length 2")
                if not all(isinstance(i, int) and i >= 0 for i in coordinate):
                    raise ToolParsingError(
                        f"{coordinate} must be a tuple of non-negative ints"
                    )

                if action == "mouse_move":
                    return await common.mouse_move(coordinate[0], coordinate[1])
                elif action == "left_click_drag":
                    return await common.left_click_drag(coordinate[0], coordinate[1])

            if action in ("key", "type"):
                if text is None:
                    raise ToolParsingError(f"text is required for {action}")
                if coordinate is not None:
                    raise ToolParsingError(f"coordinate is not accepted for {action}")
                if not isinstance(text, str):
                    raise ToolParsingError(output=f"{text} must be a string")

                if action == "key":
                    return await common.press_key(text)
                elif action == "type":
                    return await common.type(text)

            if action in (
                "left_click",
                "right_click",
                "double_click",
                "middle_click",
                "screenshot",
                "cursor_position",
            ):
                if text is not None:
                    raise ToolParsingError(f"text is not accepted for {action}")
                if coordinate is not None:
                    raise ToolParsingError(f"coordinate is not accepted for {action}")

                if action == "screenshot":
                    return await common.screenshot()
                elif action == "cursor_position":
                    return await common.cursor_position()
                elif action == "left_click":
                    return await common.left_click()
                elif action == "right_click":
                    return await common.right_click()
                elif action == "middle_click":
                    return await common.middle_click()
                elif action == "double_click":
                    return await common.double_click()

            raise ToolParsingError(f"Invalid action: {action}")

        except Exception as e:
            return f"An error occurred while executing the action: {e}"

    return execute
