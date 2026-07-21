import json
import sys
from typing import Any

from anki.collection import Collection
from anki.consts import MODEL_CLOZE


DEFAULT_DECK = "z::1 ∞ (manual catch-all)::0 interview prep::0 mcp"
CLOZE_TABLE_DECK = "z::ClozeTableManager Fixtures"

NOTETYPES = {
    "1 Basic": [
        "Front",
        "Back",
        "Context 💡",
        "Extra ➕",
        "Source 🎯",
        "🔹Abbrev Short 🆎",
        "🔹Add Reverse 🔀",
        "Extra Image \U0001F5BC\uFE0F",
    ],
    "2 Cloze": ["⭐Text", "Extra Text", "Context 💡", "Source 🏴", "Source 🎯"],
    "7 Programming Language Function": [
        "⭐Function Name",
        "⭐🔳Programming Language (Excel / Java / JavaScript / Python / R / Ruby / Scala / SQL)",
        "⭐Return Type",
        "⭐Function Description",
        "🔹Library/Package",
        "🔹Arguments",
        "🔹Input",
        "🔹Input Transformation",
        "Transformation Result",
        "🔹Time Complexity",
        "Complexity Specification",
        "Context 💡",
        "Source 🎯",
    ],
    "8 Interview Question": [
        "⭐Title",
        "⭐Question",
        "⭐Example Input/Output",
        "⭐Insight",
        "⭐Time Complexity",
        "⭐Space Complexity",
        "Additional Criteria",
        "Insight Explanation",
        "Complexity specifications",
        "🔹Key Data Structure",
        "Solution Algorithm",
        "Context 💡",
        "Source 🎯",
    ],
}


def ensure_notetype(collection: Collection, name: str, field_names: list[str]) -> None:
    if collection.models.by_name(name) is not None:
        return

    notetype = collection.models.new(name)
    if name == "2 Cloze":
        notetype["type"] = MODEL_CLOZE

    for field_name in field_names:
        collection.models.add_field(notetype, collection.models.new_field(field_name))

    template = collection.models.new_template("Card 1")
    first_field = field_names[0]
    if name == "2 Cloze":
        template["qfmt"] = f"{{{{cloze:{first_field}}}}}"
        template["afmt"] = f"{{{{cloze:{first_field}}}}}"
    else:
        template["qfmt"] = f"{{{{{first_field}}}}}"
        template["afmt"] = f"{{{{FrontSide}}}}<hr id=answer>{{{{{field_names[1]}}}}}"
    collection.models.add_template(notetype, template)
    collection.models.add(notetype)


def initialize_collection(collection: Collection) -> None:
    collection.decks.id(DEFAULT_DECK)
    collection.decks.id(CLOZE_TABLE_DECK)
    for name, field_names in NOTETYPES.items():
        ensure_notetype(collection, name, field_names)


def serialize_note(collection: Collection, note_id: int) -> dict[str, Any]:
    note = collection.get_note(note_id)
    notetype = note.note_type()
    fields = {
        field["name"]: {"value": note.fields[field["ord"]], "order": field["ord"]}
        for field in notetype["flds"]
    }
    return {
        "noteId": int(note.id),
        "modelName": notetype["name"],
        "tags": note.tags,
        "fields": fields,
        "cards": [int(card_id) for card_id in note.card_ids()],
    }


def add_note(collection: Collection, params: dict[str, Any]) -> int:
    note_params = params["note"]
    notetype = collection.models.by_name(note_params["modelName"])
    if notetype is None:
        raise ValueError(f"model was not found: {note_params['modelName']}")

    note = collection.new_note(notetype)
    valid_fields = set(note.keys())
    for field_name, value in note_params["fields"].items():
        if field_name not in valid_fields:
            raise ValueError(f"field was not found: {field_name}")
        note[field_name] = value
    note.tags = list(note_params.get("tags", []))

    deck_id = collection.decks.id(note_params["deckName"])
    collection.add_note(note, deck_id)
    return int(note.id)


def notes_info(collection: Collection, params: dict[str, Any]) -> list[dict[str, Any]]:
    existing_note_ids = {int(note_id) for note_id in collection.find_notes("")}
    return [
        serialize_note(collection, int(note_id))
        for note_id in params["notes"]
        if int(note_id) in existing_note_ids
    ]


def update_note_fields(collection: Collection, params: dict[str, Any]) -> None:
    note_params = params["note"]
    note = collection.get_note(int(note_params["id"]))
    valid_fields = set(note.keys())
    for field_name, value in note_params["fields"].items():
        if field_name not in valid_fields:
            raise ValueError(f"field was not found: {field_name}")
        note[field_name] = value
    collection.update_note(note)


def run_action(collection: Collection, action: str, params: dict[str, Any]) -> Any:
    if action == "addNote":
        return add_note(collection, params)
    if action == "notesInfo":
        return notes_info(collection, params)
    if action == "updateNoteFields":
        return update_note_fields(collection, params)
    if action == "findNotes":
        return [int(note_id) for note_id in collection.find_notes(params["query"])]
    if action == "deckNames":
        return [deck.name for deck in collection.decks.all_names_and_ids()]
    raise ValueError(f"unsupported fixture action: {action}")


def main() -> None:
    request = json.load(sys.stdin)
    collection = Collection(request["collectionPath"])
    try:
        initialize_collection(collection)
        result = run_action(collection, request["action"], request.get("params", {}))
        json.dump({"result": result, "error": None}, sys.stdout)
    except Exception as error:
        json.dump({"result": None, "error": str(error)}, sys.stdout)
    finally:
        collection.close()


if __name__ == "__main__":
    main()
