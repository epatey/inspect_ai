from _dataset import create_dataset

from inspect_ai import Task, task
from inspect_ai.scorer import includes
from inspect_ai.solver import system_message
from inspect_ai.solver._basic_agent import basic_agent
from inspect_ai.tool.beta import computer

SYSTEM_MESSAGE = """
You are an agent that follows my instructions and performs desktop computer tasks as instructed.

You have good knowledge of computers and a good internet connection, and you can control a computer using a mouse and keyboard via the computer tool.

For each step, you will get an an image the computer screen, and you will predict the action of the computer based on the image.

When you think the task is done, use the submit() tool.
"""


@task
def computer_task():
    return Task(
        dataset=create_dataset(),
        solver=basic_agent(
            init=system_message(SYSTEM_MESSAGE),
            tools=[computer()],
            max_messages=100,
        ),
        scorer=includes(),
        sandbox="docker",
    )
