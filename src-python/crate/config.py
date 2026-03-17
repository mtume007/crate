import json
import os
from pathlib import Path

CONFIG_PATH = Path.home() / '.crate' / 'config.json'

DEFAULTS = {
    "ai": {
        "provider": "anthropic",
        "model": "claude-sonnet-4-6",
        "api_key": ""
    },
    "theme": {
        "accent": "#e8a045",
        "base": "#080808",
        "card": "#0f0f0f",
        "hover": "#161616",
        "border": "#1e1e1e",
        "radius": 8,
        "font": "Outfit"
    },
    "library": {
        "path": "/Users/pedersimonsen/Music/Music/Media.localized/Music",
        "organise": False
    },
    "enrichment": {
        "discogs_token": "",
        "auto_enrich": False,
        "source": "enriched"
    }
}

def load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH) as f:
                saved = json.load(f)
            # Deep merge saved over defaults
            return _deep_merge(DEFAULTS, saved)
        except Exception:
            pass
    return dict(DEFAULTS)

def save_config(config: dict):
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, 'w') as f:
        json.dump(config, f, indent=2)

def _deep_merge(base: dict, override: dict) -> dict:
    result = dict(base)
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result
