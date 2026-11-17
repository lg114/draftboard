"""
CLI entry point for the Draftboard workbench.

Usage:
    draftboard run "Your prompt here" [--output result.json]
    draftboard init <project_id>
"""

import argparse
import asyncio
import json
import pathlib
import sys

from dotenv import load_dotenv

load_dotenv()


def main() -> None:
    parser = argparse.ArgumentParser(description="Draftboard AI workbench CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    # run: run agent with a prompt
    run_p = sub.add_parser("run", help="Run agent with a prompt")
    run_p.add_argument("prompt", help="Prompt to send to the agent")
    run_p.add_argument("--output", "-o", help="Save result to this JSON file")

    # init: create a project directory with sample assets
    init_p = sub.add_parser("init", help="Init a new project")
    init_p.add_argument("project_id", help="Project ID")

    args = parser.parse_args()

    if args.command == "run":
        from draftboard.agent import run_agent

        try:
            result = asyncio.run(run_agent(args.prompt))
            print(result)
            if args.output:
                pathlib.Path(args.output).write_text(
                    json.dumps({"result": result}, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
            sys.exit(0)
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)

    elif args.command == "init":
        project_root = (
            pathlib.Path.home()
            / ".draftboard"
            / "projects"
            / args.project_id
            / "assets"
        )
        project_root.mkdir(parents=True, exist_ok=True)
        sample = project_root / "intro.md"
        sample.write_text(
            "# My Project\n\nThis is a sample material file.\n\n"
            "## Background\n\nAdd your content here.\n",
            encoding="utf-8",
        )
        print(f"Project '{args.project_id}' initialized at {project_root.parent}")
        sys.exit(0)


if __name__ == "__main__":
    main()
