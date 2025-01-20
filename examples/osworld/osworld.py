from _dataset import create_dataset

from inspect_ai import Task, task
from inspect_ai.scorer import includes
from inspect_ai.solver import system_message
from inspect_ai.solver._basic_agent import basic_agent
from inspect_ai.tool.beta import computer

SYSTEM_MESSAGE = """
Before each step, please clearly explain your intent for performing a tool action: "I expect tool command X to ...".

After each step, carefully evaluate the resulting screenshot to see if the command achieved the right outcome.

Explicitly show your thinking: "I have evaluated step X..." If not correct, try again. Only when
you confirm a step was executed correctly should you move on to the next one.

Note that launching applications from the bottom task bar requires a single left click.
"""


@task
def computer_task():
    return Task(
        dataset=create_dataset(),
        # dataset=[
        #     Sample(
        #         input="Could you make the background of this image transparent for me?",
        #         files={
        #             "/home/user/Desktop/dog_with_background.png": "https://drive.google.com/uc?export=download&id=1TOtPi1CQsWblGUtQ6AqayfjsPZ_THBJo",
        #             "/home/user/Desktop/dog_cutout_gold.png": "https://drive.google.com/uc?export=download&id=15YWmeOyUaA7vMX9Ts7-qyh82T8mHeepx",
        #         },
        #         setup="/home/user/_hack_setup.sh",
        #     ),
        # ],
        solver=basic_agent(
            init=system_message(SYSTEM_MESSAGE),
            tools=[computer()],
            max_messages=100,
        ),
        scorer=includes(),
        sandbox="docker",
    )
