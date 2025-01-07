import logging


def setup_logger(level=logging.INFO):
    new_logger = logging.getLogger("computer_tool")
    new_logger.setLevel(level)

    stdout_handler = logging.FileHandler("/proc/1/fd/1", mode="w")
    stdout_handler.setLevel(level)
    stdout_handler.setFormatter(
        logging.Formatter("%(name)s(pid=%(process)d) - %(levelname)s - %(message)s")
    )

    if not new_logger.handlers:
        new_logger.addHandler(stdout_handler)

    return new_logger
