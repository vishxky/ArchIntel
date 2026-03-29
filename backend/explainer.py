"""
explainer.py — Stage 5: LLM Explainability
=============================================
Generates plain-language structural explanations for every wall using an LLM.

Key Design Principle (from Plan.md):
    "The LLM doesn't make the decision — TOPSIS does. The LLM receives the
     computed results and translates them into human-readable explanations.
     It's a communicator, not a decision-maker."

Provider Strategy:
    Primary:  Gemini 3 Flash (google-genai)  — best reasoning quality
    Fallback: Mistral Small 2501 (mistralai) — if Gemini fails

Both providers use Pydantic structured output for guaranteed JSON format.
"""

import os
import json
import time
from pydantic import BaseModel, Field
from typing import Optional


# ─────────────────────────────────────────────────────────────────────────────
# STRUCTURED OUTPUT SCHEMA
# ─────────────────────────────────────────────────────────────────────────────

class WallExplanation(BaseModel):
    """Schema for LLM-generated structural explanation."""
    wall_id: str = Field(description="The wall identifier, e.g. W1, W5")
    explanation: str = Field(
        description="Plain-language structural explanation in 3-4 sentences. "
                    "Must cite exact TOPSIS scores, dimensions, and material names "
                    "from the provided data. Written for a homeowner, not an engineer."
    )
    critical_concern: Optional[str] = Field(
        default=None,
        description="Single most important structural concern, or null if none exist"
    )


# ─────────────────────────────────────────────────────────────────────────────
# SYSTEM PROMPT — identical for both providers
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a structural design assistant explaining construction 
material recommendations to a homeowner with no engineering background.

Rules:
1. State which structural element you're analyzing (e.g., "horizontal partition wall, 5.26m long")
2. Explain WHY it's classified as load-bearing or partition in plain language
3. Give your top 2-3 material recommendations with specific reasoning
4. Cite the TOPSIS scores from the provided data (e.g., "scored 0.705")
5. Flag any structural concerns from the 'concerns' field if present
6. Use short paragraphs, not bullet lists
7. Do NOT invent numbers — copy EXACTLY from the provided JSON
8. Use simple analogies where helpful (e.g., "like the spine of a book")
9. Keep to 3-4 sentences maximum"""


# ─────────────────────────────────────────────────────────────────────────────
# PREPARE WALL DATA FOR THE LLM (strip unnecessary fields)
# ─────────────────────────────────────────────────────────────────────────────

def prepare_wall_context(wall: dict) -> dict:
    """
    Build a clean JSON context for the LLM from a wall dict.
    Only include fields the LLM needs — no pixel data or internal IDs.
    """
    topsis = wall.get("topsis_results", {})
    return {
        "wall_id": wall["id"],
        "type": wall.get("type", "unknown"),
        "classification_reason": wall.get("reason", ""),
        "orientation": wall.get("orientation", "unknown"),
        "length_m": wall.get("length_m", 0),
        "thickness_m": wall.get("thickness_m", 0),
        "concerns": wall.get("concerns"),
        "topsis_results": {
            "weight_profile": topsis.get("weight_profile", {}),
            "rankings": topsis.get("rankings", []),
        }
    }


# ─────────────────────────────────────────────────────────────────────────────
# GEMINI PROVIDER (Primary)
# ─────────────────────────────────────────────────────────────────────────────

def explain_wall_gemini(wall_context: dict, api_key: str) -> WallExplanation:
    """Generate explanation using Gemini 3 Flash."""
    from google import genai

    client = genai.Client(api_key=api_key)

    user_prompt = f"""Analyze this structural element and recommend materials:

{json.dumps(wall_context, indent=2)}

Provide a clear, evidence-backed explanation."""

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=user_prompt,
        config={
            "system_instruction": SYSTEM_PROMPT,
            "response_mime_type": "application/json",
            "response_schema": WallExplanation,
            "temperature": 0.2,
            "max_output_tokens": 400,
        },
    )

    return WallExplanation.model_validate_json(response.text)


# ─────────────────────────────────────────────────────────────────────────────
# MISTRAL PROVIDER (Fallback)
# ─────────────────────────────────────────────────────────────────────────────

def explain_wall_mistral(wall_context: dict, api_key: str) -> WallExplanation:
    """Generate explanation using Mistral Small 2501."""
    from mistralai.client.sdk import Mistral

    client = Mistral(api_key=api_key)

    response = client.chat.parse(
        model="mistral-small-2501",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Analyze this structural element and recommend materials:\n\n"
                           f"{json.dumps(wall_context, indent=2)}\n\n"
                           f"Provide a clear, evidence-backed explanation."
            },
        ],
        response_format=WallExplanation,
        temperature=0,
        max_tokens=400,
    )
    time.sleep(1)  # Respect Mistral's 1 req/sec free tier limit
    return response.choices[0].message.parsed


# ─────────────────────────────────────────────────────────────────────────────
# ORCHESTRATOR — explain a single wall with automatic fallback
# ─────────────────────────────────────────────────────────────────────────────

def explain_wall(wall: dict) -> dict:
    """
    Generate a plain-language explanation for one wall.
    Tries Mistral first (reliable), falls back to Gemini, then to a template.
    Returns a dict with 'explanation' and optionally 'critical_concern'.
    """
    wall_context = prepare_wall_context(wall)

    mistral_key = os.environ.get("MISTRAL_API_KEY", "")
    gemini_key = os.environ.get("GEMINI_API_KEY", "")

    # Try Mistral (primary — reliable free tier)
    if mistral_key:
        try:
            result = explain_wall_mistral(wall_context, mistral_key)
            return {
                "wall_id": result.wall_id,
                "explanation": result.explanation,
                "critical_concern": result.critical_concern,
                "provider": "mistral-small",
            }
        except Exception as e:
            print(f"  ⚠ Mistral failed for {wall['id']}: {e}")

    # Try Gemini (fallback)
    if gemini_key:
        try:
            result = explain_wall_gemini(wall_context, gemini_key)
            return {
                "wall_id": result.wall_id,
                "explanation": result.explanation,
                "critical_concern": result.critical_concern,
                "provider": "gemini-flash",
            }
        except Exception as e:
            print(f"  ⚠ Gemini failed for {wall['id']}: {e}")

    # Template fallback (no LLM available)
    return generate_template_explanation(wall)


def generate_template_explanation(wall: dict) -> dict:
    """
    Deterministic template-based explanation when no LLM is available.
    Still cites exact numbers — just less natural language.
    """
    wtype = wall.get("type", "partition")
    reason = wall.get("reason", "classified by heuristic rules")
    length = wall.get("length_m", 0)
    thickness = wall.get("thickness_m", 0)
    orientation = wall.get("orientation", "")
    topsis = wall.get("topsis_results", {})
    rankings = topsis.get("rankings", [])
    concerns = wall.get("concerns")

    type_desc = "load-bearing structural wall" if wtype == "load_bearing" else "interior partition wall"

    parts = [
        f"This is a {length}m {orientation} {type_desc} with {int(thickness * 1000)}mm thickness, "
        f"classified because: {reason}."
    ]

    if rankings:
        top = rankings[0]
        parts.append(
            f"TOPSIS analysis recommends {top['name']} as the optimal material "
            f"with a closeness score of {top['score']:.3f}."
        )
        if len(rankings) >= 2:
            r2 = rankings[1]
            parts.append(
                f"{r2['name']} ({r2['score']:.3f}) is a viable alternative."
            )

    concern_text = None
    if concerns:
        concern_text = concerns[0].get("message", "")
        parts.append(f"Note: {concern_text}")

    return {
        "wall_id": wall["id"],
        "explanation": " ".join(parts),
        "critical_concern": concern_text,
        "provider": "template",
    }


# ─────────────────────────────────────────────────────────────────────────────
# BATCH ORCHESTRATOR — explain all walls in a parsed plan
# ─────────────────────────────────────────────────────────────────────────────

def explain_all(parsed_data: dict) -> dict:
    """
    Main entry point for Stage 5.
    Generates explanations for every wall and attaches them to the data.
    """
    walls = parsed_data.get("walls", [])
    print(f"\n  Stage 5: Generating explanations for {len(walls)} walls...")

    for i, wall in enumerate(walls):
        print(f"    [{i+1}/{len(walls)}] Explaining {wall['id']}...")
        result = explain_wall(wall)
        wall["explanation"] = result["explanation"]
        wall["critical_concern"] = result.get("critical_concern")
        wall["llm_provider"] = result.get("provider", "unknown")
        time.sleep(0.3)  # Gentle throttle

    providers_used = set(w.get("llm_provider", "") for w in walls)
    parsed_data["explainability"] = {
        "walls_explained": len(walls),
        "providers_used": list(providers_used),
    }

    print(f"  ✓ Stage 5 complete — {len(walls)} walls explained via {providers_used}")
    return parsed_data
