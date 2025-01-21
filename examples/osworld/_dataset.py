import os

from _example import Config, example_from_file
from _sparse_clone import sparse_clone_repo

from inspect_ai.dataset._dataset import Dataset, MemoryDataset, Sample


def create_dataset() -> Dataset:
    with sparse_clone_repo(
        repo_url="https://github.com/xlang-ai/OSWorld.git",
        sparse_dir="evaluation_examples/examples/gimp",
        prefix="_osworld_",
    ) as sparse_dir:
        dataset = MemoryDataset(
            [
                sample
                for root, _, filenames in os.walk(sparse_dir)
                for filename in filenames
                if (sample := _sample_from_file(os.path.join(root, filename)))
                is not None
            ]
        )
        print(f"returning dataset\n\t{dataset.samples}")
        return dataset


def _sample_from_file(file_path: str) -> Sample | None:
    example = example_from_file(file_path)

    return Sample(
        example.instruction,
        id=example.id,
        files=files_from_config(example.config),
        setup=setup_from_config(example.config),
        metadata={field: getattr(example, field) for field in ["snapshot", "source"]},
    )


def files_from_config(configEntries: list[Config]) -> dict[str, str] | None:
    files = {
        file.path: file.url
        for config in configEntries
        if config.type == "download"
        for file in config.parameters.files
    }
    return files if files else None


def setup_from_config(configEntries: list[Config]) -> str | None:
    # for now, just look for "launch"'s. Ultimately, we'll just walk the
    # whole list skipping only "download"'s
    commands = [
        f"{' '.join(config.parameters.command)} &"
        for config in configEntries
        if config.type == "launch"
    ]

    return " && ".join(commands) if commands else None
