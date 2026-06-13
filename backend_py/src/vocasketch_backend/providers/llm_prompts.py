from __future__ import annotations

from textwrap import dedent

from ..workflows.state import DrawingWorkflowState


def build_parse_intent_prompt(*, input_text: str, locale: str) -> tuple[str, str]:
    system_prompt = dedent(
        """
        You are a creative intent parser for an AI drawing workflow.
        Return valid JSON only.
        Extract the user's visual intent for a high-quality illustration pipeline.

        Required JSON schema:
        {
          "subject": string,
          "style": string,
          "composition": string,
          "constraints": string[],
          "edits": string[],
          "ambiguities": string[],
          "confidence": number
        }

        Rules:
        - Respect the user's stated style and subject.
        - Favor high-quality illustration outputs over rough canvas doodles.
        - Include constraints that help later image generation and layer playback.
        - If the request is underspecified, put open questions in ambiguities instead of inventing details.
        - confidence must be between 0 and 1.
        """
    ).strip()
    user_prompt = dedent(
        f"""
        Locale: {locale}
        User request:
        {input_text}
        """
    ).strip()
    return system_prompt, user_prompt


def build_visual_brief_prompt(state: DrawingWorkflowState) -> tuple[str, str]:
    system_prompt = dedent(
        """
        You are a senior visual development artist preparing a production-ready design brief.
        Return valid JSON only.

        Required JSON schema:
        {
          "artDirection": string,
          "camera": string,
          "palette": string[],
          "mood": string,
          "characterSpec": string,
          "backgroundSpec": string,
          "negativeConstraints": string[]
        }

        Rules:
        - Keep the result aligned with the parsed user intent.
        - Optimize for premium anime / illustration quality when the user does not specify a conflicting style.
        - Keep the brief useful for downstream image generation and layer-based playback.
        """
    ).strip()
    parsed_intent_json = state.parsedIntent.model_dump_json(indent=2) if state.parsedIntent else "null"
    user_prompt = dedent(
        f"""
        User request:
        {state.inputText}

        Parsed intent:
        {parsed_intent_json}
        """
    ).strip()
    return system_prompt, user_prompt


def build_image_prompt_prompt(state: DrawingWorkflowState) -> tuple[str, str]:
    system_prompt = dedent(
        """
        You are preparing a high-quality image generation prompt package for a staged drawing workflow.
        Return valid JSON only.

        Required JSON schema:
        {
          "model": string,
          "positivePrompt": string,
          "negativePrompt": string,
          "size": string,
          "guidance": string,
          "seed": number
        }

        Rules:
        - positivePrompt should be rich and production-friendly.
        - negativePrompt should explicitly avoid messy anatomy, crude doodles, and unfinished outputs.
        - size should be a practical square or portrait canvas for character illustration.
        - guidance should mention layer-friendly or playback-friendly drawing progression when appropriate.
        - seed must be an integer.
        """
    ).strip()
    parsed_intent_json = state.parsedIntent.model_dump_json(indent=2) if state.parsedIntent else "null"
    visual_brief_json = state.visualBrief.model_dump_json(indent=2) if state.visualBrief else "null"
    user_prompt = dedent(
        f"""
        User request:
        {state.inputText}

        Parsed intent:
        {parsed_intent_json}

        Visual brief:
        {visual_brief_json}
        """
    ).strip()
    return system_prompt, user_prompt
