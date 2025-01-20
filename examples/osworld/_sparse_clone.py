import os
import subprocess
import tempfile
from contextlib import contextmanager


@contextmanager
def sparse_clone_repo(
    repo_url: str,
    sparse_dir: str,
    prefix: str | None = None,
):
    repo_path = tempfile.mkdtemp(prefix=prefix)

    try:
        subprocess.run(
            [
                "git",
                "clone",
                "--depth",
                "1",
                "--filter=blob:none",
                "--sparse",
                repo_url,
                repo_path,
            ],
            check=True,
        )
        subprocess.run(
            [
                "git",
                "sparse-checkout",
                "set",
                "--no-cone",
                sparse_dir,
            ],
            cwd=repo_path,
            check=True,
        )

        yield os.path.join(repo_path, sparse_dir)
    finally:
        if os.path.exists(repo_path):
            subprocess.run(["rm", "-rf", repo_path])
