import asyncio
import shlex
from typing import Awaitable, Callable

from inspect_ai.model import Content
from inspect_ai.tool import Tool, tool
from inspect_ai.tool._tools._computer._computer_common import (cursor_position,
                                                               double_click,
                                                               left_click,
                                                               left_click_drag,
                                                               middle_click,
                                                               mouse_move,
                                                               press_key,
                                                               right_click,
                                                               screenshot,
                                                               type)

# Export ToolResult from inspect_ai.tool
ToolResult = str | int | float | bool | list[Content]

ActionFunction = Callable[[str], ToolResult | Awaitable[ToolResult]]


@tool(parallel=False)
def computer(timeout: int | None = None) -> Tool:
    """
    Computer interaction tool.

    Use a mouse and keyboard to interact with a computer, and take screenshots.
      * This is an interface to a desktop GUI. You must click on desktop menus or icons to start applications.
      * Before taking any action, it's wise to consult the result of a screenshot action to determine current state
      of the computer. Without doing so, you may not be able to complete the task.

    Args:
      timeout (int | None): Timeout (in seconds) for command.

    Important:
    - When attempting to click on an element, move the mouse to the middle of the element before clicking. This will help ensure that the click is registered.
    - Keep in mind that icons require double clicks to open while other UI affordances like menu items and buttons require a single click.

    Returns:
      Image for each screenshot command executed.
    """

    async def execute(cmd: str) -> ToolResult:
        """
        Use this tool to interact with the computer.

        Use a mouse and keyboard to interact with a computer, and take screenshots.
          * This is an interface to a desktop GUI. You must click on desktop menus or icons to start applications.
          * Before taking any action, it's wise to consult the result of a screenshot action to determine current state
            of the computer. Without doing so, you may not be able to complete the task.

        Keep in mind that icons require double clicks to open while other UI affordances like menu items and buttons require a single click.

        Args:
          cmd (str): The action to perform. The available actions are:
            * `key`: Press a key or key-combination on the keyboard.
            *     - This supports xdotool's `key`.
            *     - Examples: "Return", "Escape", "alt+Tab", "BackSpace", "Tab", "alt+Tab", "ctrl+s", "Up", "KP_0" (for the numpad 0 key),
            *         "Insert", "Delete", "Home", "End", "Prior", "Next", "Left", "Up", "Right", "Down",
            *         "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
            *         "Shift_L", "Shift_R", "Control_L", "Control_R", "Alt_L", "Alt_R", "Scroll_Lock", "Num_Lock", "Caps_Lock", "Pause",
            *         "KP_Multiply", "KP_Home", "KP_Up", "KP_Prior", "KP_Subtract", "KP_Left", "KP_Begin", "KP_Right", "KP_Add", "KP_End","KP_Down",
            *         "KP_Next", "KP_Insert", "KP_Delete", "KP_Enter", "KP_Divide", "KP_Equal", "KP_Decimal",
            * `type`: Type a string of text on the keyboard. If the text contains spaces, enclose it in quotes.
            * `cursor_position`: Get the current (x, y) pixel coordinate of the cursor on the screen.
            * `mouse_move`: Move the cursor to a specified (x, y) pixel coordinate on the screen.
            * `left_click`: Click the left mouse button.
            * `left_click_drag`: Click and drag the cursor to a specified (x, y) pixel coordinate on the screen.
            * `right_click`: Click the right mouse button.
            * `middle_click`: Click the middle mouse button.
            * `middle_click`: Click the middle mouse button.
            * `double_click`: Double-click the left mouse button.
            * `screenshot`: Take a screenshot of the screen.

        Returns:
          The output of the command. Many commands will include a screenshot reflecting the result of the command in their response.
        """
        parts = cmd.split(maxsplit=1)
        if not parts:
            raise ValueError("Empty command")

        action = parts[0]
        arguments = parts[1] if len(parts) > 1 else ""

        async def key_action(args: str) -> ToolResult:
            return await press_key(args)

        async def type_action(args: str) -> ToolResult:
            return await type(validate_type(args))

        async def cursor_position_action(args: str) -> str:
            validate_no_args(args, "cursor_position")
            return await cursor_position()

        async def mouse_move_action(args: str) -> ToolResult:
            x, y = validate_coordinates(args, "mouse_move")
            return await mouse_move(x, y)

        async def left_click_action(args: str) -> ToolResult:
            validate_no_args(args, "left_click")
            return await left_click()

        async def left_click_drag_action(args: str) -> ToolResult:
            endx, endy = validate_coordinates(args, "left_click_drag")
            return await left_click_drag(endx, endy)

        async def right_click_action(args: str) -> ToolResult:
            validate_no_args(args, "right_click")
            return await right_click()

        async def middle_click_action(args: str) -> ToolResult:
            validate_no_args(args, "middle_click")
            return await middle_click()

        async def double_click_action(args: str) -> ToolResult:
            validate_no_args(args, "double_click")
            return await double_click()

        async def screenshot_action(args: str) -> ToolResult:
            validate_no_args(args, "screenshot")
            return await screenshot()

        # Dictionary to map actions to functions
        action_map: dict[str, ActionFunction] = {
            "key": key_action,
            "type": type_action,
            "cursor_position": cursor_position_action,
            "mouse_move": mouse_move_action,
            "left_click": left_click_action,
            "left_click_drag": left_click_drag_action,
            "right_click": right_click_action,
            "middle_click": middle_click_action,
            "double_click": double_click_action,
            "screenshot": screenshot_action,
        }

        # Execute the corresponding function
        try:
            if action in action_map:
                result: ToolResult | Awaitable[ToolResult] = action_map[action](
                    arguments
                )
                return (await result) if asyncio.iscoroutine(result) else result  # type: ignore
            else:
                available_actions = ", ".join(sorted(action_map.keys()))
                return f"Unknown action: {action}. Available actions are: {available_actions}"
        except Exception as e:
            return f"An error occurred while executing the action: {e}"

    def validate_coordinates(args: str, action_name: str) -> tuple[int, int]:
        """Validate and parse X,Y coordinate arguments."""
        try:
            # Strip any extra whitespace and split
            coords = [x.strip() for x in args.split()]

            if len(coords) != 2:
                raise ValueError(
                    f"{action_name} requires exactly 2 integer coordinates (X Y)"
                )

            # Convert to integers and validate
            x, y = map(int, coords)

            # Basic sanity check for coordinate values
            if x < 0 or y < 0:
                raise ValueError("Coordinates must be non-negative integers")

            return x, y
        except ValueError as e:
            raise ValueError(f"Invalid coordinates for {action_name}: {str(e)}")

    def validate_type(args: str) -> str:
        """Validate text for typing. Ensures a single argument is passed and handles quoted strings."""
        if not args.strip():
            raise ValueError("type command requires text to type")

        try:
            # Use shlex to properly handle quoted strings
            parsed_args = shlex.split(args)

            if len(parsed_args) != 1:
                raise ValueError(
                    "type command requires a single text argument (use quotes for text with spaces)"
                )

            return parsed_args[0]

        except ValueError as e:
            raise ValueError(f"Invalid text argument: {str(e)}")

    def validate_no_args(args: str, action_name: str) -> None:
        """Validate that no arguments are passed."""
        if args.strip():
            raise ValueError(f"{action_name} takes no arguments: {args}")

    return execute
