import os

from _example import _example_from_file
from _sparse_clone import sparse_clone_repo

from inspect_ai.dataset._dataset import Dataset, MemoryDataset, Sample


def create_dataset() -> Dataset:
    with sparse_clone_repo(
        repo_url="https://github.com/xlang-ai/OSWorld.git",
        sparse_dir="evaluation_examples/examples/gimp",
        prefix="_osworld_",
    ) as sparse_dir:
        return MemoryDataset(
            [
                sample
                for root, _, filenames in os.walk(sparse_dir)
                for filename in filenames
                if (sample := _sample_from_file(os.path.join(root, filename)))
                is not None
            ]
        )


def _sample_from_file(file_path: str) -> Sample | None:
    if (
        os.path.basename(file_path) != "2a729ded-3296-423d-aec4-7dd55ed5fbb3.json"
        or (example := _example_from_file(file_path)) is None
    ):
        return None

    return Sample(
        example.instruction,
        files={
            file.path: file.url
            for config in example.config
            if config.type == "download"
            for file in config.parameters.files
        },
    )
