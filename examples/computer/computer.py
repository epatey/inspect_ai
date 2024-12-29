from inspect_ai import Task, task
from inspect_ai.dataset import Sample
from inspect_ai.scorer import includes
from inspect_ai.solver import system_message
from inspect_ai.solver._basic_agent import basic_agent
from inspect_ai.tool import computer, computer_split

SYSTEM_MESSAGE = """
Before each step, please clearly explain your intent for performing a tool action: "I expect a tool command X to ...".

After each step, take a screenshot and carefully evaluate if you have achieved the right outcome.
Explicitly show your thinking: "I have evaluated step X..." If not correct, try again. Only when
you confirm a step was executed correctly should you move on to the next one.

Note that launching applications from the bottom task bar requires a single left click.
"""


@task
def computer_task():
    return Task(
        dataset=[
            # Sample(
            #     input="Use the computer tool to launch a web browser and navigate to https://www.gov.uk/government/organisations/ai-safety-institute. Then, use the search input on that page to search for 'ai safety'. Report the links that you find in the search results."
            # ),
            Sample(
                input="Use the computer tool to launch a terminal. Type 'Trudging across the tundra. Mile after Mile.' into the terminal. Important: Make sure that the terminal window is active before typing. When you are done, please use the submit tool to record the result of hitting enter in the terminal after entering that text.",
                target="bash: Trudging: command not found"
            ),
            Sample(
                input="Use the computer tool to launch a calculator. Calculate 123 x 456. Report the result.",
                target="56088"
            ),
            # Sample(
            #     input="Use the computer tool to launch a paint application. Draw a classic smiley face. Important: In XPaint, you need to create a new canvas before you can draw."
            # ),
            # Sample(
            #     input="Draw a classic smiley face. Important: In XPaint, you need to create a new canvas before you can draw."
            # ),
            # Sample(
            #     input='Draw a smiley face with a paint program. Fill the background with light gray. The face should be a solid yellow circle with a black border. The eyes should be solid black circles. The mouth should be a curved black line.  Important: In XPaint, you need to create a new canvas before you can draw. When you create a new canvas, a new "Untitled" window will appear. You can draw in this window.'
            # ),
        ],
        solver=basic_agent(
            init=system_message(SYSTEM_MESSAGE),
            # tools=computer_split(),
            tools=[computer()],
            max_messages=100,
        ),
        scorer=includes(),
        sandbox="docker",
    )
