"""
CLI entry point for the Draftboard workbench.

Usage:
    draftboard run "Your prompt here" [--output result.json]
    draftboard init <project_id>
    draftboard export <ir_json> [-o out.pptx]
    draftboard outline <project_id> <version>
    draftboard confirm <project_id> <version>
    draftboard export-deck <project_id> <artifact_id> [--revision N]
    draftboard serve [--host HOST] [--port PORT]
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

    # export: write an IR JSON file to an editable PPTX
    export_p = sub.add_parser("export", help="Export an IR JSON file to PPTX")
    export_p.add_argument("ir_json", help="Path to the artifact IR JSON file")
    export_p.add_argument(
        "--output", "-o", help="Output .pptx path (default: alongside the IR file)"
    )

    # outline: show a saved outline for review
    outline_p = sub.add_parser("outline", help="Show a saved outline for review")
    outline_p.add_argument("project_id", help="Project ID")
    outline_p.add_argument("version", help="Outline version, e.g. v-abc12345")

    # confirm: user explicitly approves an outline
    confirm_p = sub.add_parser("confirm", help="Confirm an outline (user approval)")
    confirm_p.add_argument("project_id", help="Project ID")
    confirm_p.add_argument("version", help="Outline version to confirm")

    # export-deck: export a stored artifact revision to PPTX
    deck_p = sub.add_parser("export-deck", help="Export a stored artifact to PPTX")
    deck_p.add_argument("project_id", help="Project ID")
    deck_p.add_argument("artifact_id", help="Artifact ID")
    deck_p.add_argument(
        "--revision", type=int, default=None, help="Revision (default: latest)"
    )

    # serve: run the web API + minimal workbench page
    serve_p = sub.add_parser("serve", help="Run the Draftboard web API")
    serve_p.add_argument("--host", default="127.0.0.1", help="Bind host")
    serve_p.add_argument("--port", type=int, default=8000, help="Bind port")
    serve_p.add_argument("--reload", action="store_true", help="Enable auto-reload on code changes")

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

    elif args.command == "export":
        from draftboard.models import Artifact
        from draftboard.pptx_export import export_pptx

        ir_path = pathlib.Path(args.ir_json)
        output = (
            pathlib.Path(args.output)
            if args.output
            else ir_path.with_suffix(".pptx")
        )
        try:
            artifact = Artifact.model_validate_json(
                ir_path.read_text(encoding="utf-8")
            )
            export_pptx(artifact, output)
        except Exception as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
        print(
            f"Exported {len(artifact.slides)} slides to {output}"
        )
        sys.exit(0)

    elif args.command == "outline":
        from draftboard.storage import ProjectStorage

        try:
            storage = ProjectStorage(args.project_id)
            outline = storage.load_outline(args.version)
        except KeyError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
        status = "CONFIRMED" if outline.is_confirmed else "DRAFT (not confirmed)"
        print(f"Outline {outline.outline_version} [{status}]")
        for i, item in enumerate(outline.items, start=1):
            layout = item.layout.value if item.layout else "auto"
            print(f"\n{i}. [{item.outline_item_id}] {item.title} (layout: {layout})")
            print(f"   {item.summary}")
            print(f"   sources: {', '.join(item.source_ids)} | evidence: {item.evidence_status.value}")
        if not outline.is_confirmed:
            path = storage.root / "outlines" / f"{outline.outline_version}.json"
            print(f"\nTo edit: modify {path}")
            print(f"To approve: draftboard confirm {args.project_id} {outline.outline_version}")
        sys.exit(0)

    elif args.command == "confirm":
        from draftboard.storage import ProjectStorage

        try:
            storage = ProjectStorage(args.project_id)
            outline = storage.confirm_outline(args.version)
        except KeyError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
        print(f"Outline {outline.outline_version} confirmed ({len(outline.items)} items).")
        sys.exit(0)

    elif args.command == "export-deck":
        from draftboard.storage import ProjectStorage
        from draftboard.tools import export_deck_impl

        storage = ProjectStorage(args.project_id)
        revision = args.revision
        if revision is None:
            revision = storage.next_revision(args.artifact_id) - 1
        if revision < 1:
            print(f"Error: artifact '{args.artifact_id}' has no revisions.", file=sys.stderr)
            sys.exit(1)
        try:
            result = export_deck_impl(args.project_id, args.artifact_id, revision)
        except KeyError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
        if result.success:
            print(f"Exported {result.slide_count} slides to {result.pptx_path}")
            sys.exit(0)
        print("Export failed:", file=sys.stderr)
        for issue in result.issues:
            print(f"  [{issue.code}] {issue.message}", file=sys.stderr)
        sys.exit(1)

    elif args.command == "serve":
        import uvicorn

        print(f"Draftboard workbench: http://{args.host}:{args.port}/")
        uvicorn.run("draftboard.api:app", host=args.host, port=args.port, reload=args.reload)
        sys.exit(0)


if __name__ == "__main__":
    main()
