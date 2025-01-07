import argparse
import asyncio
import json
import logging
import os
import sys
import time

from _logger import setup_logger
from _tool_result import ToolResult
from _x11_client import X11Client

my_logger = setup_logger(logging.INFO)


async def wait_for_file(file_path, check_interval=1):
    if os.path.exists(file_path):
        return
    my_logger.info(f"Waiting for {file_path}")
    start_time = time.time()
    while not os.path.exists(file_path):
        await asyncio.sleep(check_interval)
    my_logger.info(
        f"Done waiting for {file_path} after {time.time() - start_time:.1f} seconds"
    )


def parse_arguments():
    parser = argparse.ArgumentParser(description="Execute computer tool action")
    parser.add_argument("--action", type=str, required=True, help="Action to perform")
    parser.add_argument("--text", type=str, help="Optional text parameter")
    parser.add_argument(
        "--coordinate",
        type=int,
        nargs=2,
        help="Optional coordinate parameter as a list of two integers",
    )
    return parser.parse_args()


async def execute_action(args) -> ToolResult:
    await wait_for_file("/tmp/mutter_started")

    computer = X11Client()
    return await computer(
        action=args.action,
        text=args.text,
        coordinate=args.coordinate if args.coordinate else None,
    )


def main():
    try:
        args = parse_arguments()
        my_logger.info(f"({args})")
        result = asyncio.run(execute_action(args))

        print(
            json.dumps(
                {
                    "output": result.output,
                    "error": result.error,
                    "base64_image": result.base64_image,
                }
            )
        )
        my_logger.debug("SUCCESS")
    except Exception as e:
        my_logger.warning(f"An error occurred: {e}")
        print(f"An error occurred: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
