import json
import os
import sys
import tempfile
from typing import Any

from anki.collection import Collection
from anki.consts import CARD_TYPE_REV, QUEUE_TYPE_REV, QUEUE_TYPE_SUSPENDED

VISIBLE_FIELDS = [
    "Front Text",
    "Front Replacement Text for Back",
    "Answer",
    "Hint",
    "Extra Text",
]
HIDDEN_FIELDS = [
    "zdone Unified ID",
    "Is Multi Answer?",
    "Front Image",
    "Back Image",
    "Source",
    "Debug",
]


def add_fields(collection: Collection, notetype: Any, field_names: list[str]) -> None:
    existing_names = {field["name"] for field in notetype["flds"]}
    for field_name in field_names:
        if field_name not in existing_names:
            collection.models.add_field(notetype, collection.models.new_field(field_name))
    collection.models.update_dict(notetype)


def create_non_basic_notetype(collection: Collection) -> Any:
    notetype = collection.models.new("Fixture Non-Basic")
    for field_name in VISIBLE_FIELDS + HIDDEN_FIELDS:
        collection.models.add_field(notetype, collection.models.new_field(field_name))
    template = collection.models.new_template("Card 1")
    template["qfmt"] = "{{Front Text}}"
    template["afmt"] = "{{FrontSide}}<hr id=answer>{{Answer}}"
    collection.models.add_template(notetype, template)
    collection.models.add(notetype)
    return collection.models.by_name("Fixture Non-Basic")


def add_fixture_note(
    collection: Collection,
    notetype: Any,
    deck_id: int,
    zdone_id: str,
    search_text: str,
    state: str = "review",
) -> int:
    note = collection.new_note(notetype)
    note["zdone Unified ID"] = zdone_id
    note["Front Text"] = search_text
    note["Front Replacement Text for Back"] = "Replacement"
    note["Answer"] = "Answer"
    note["Hint"] = "Hint"
    note["Extra Text"] = "Extra"
    note["Is Multi Answer?"] = "yes"
    note["Front Image"] = "front.png"
    note["Back Image"] = "back.png"
    note["Source"] = "https://example.com"
    note["Debug"] = "Generated for integration testing"

    # The stock Basic template needs Front populated to generate a card.
    if "Front" in note.keys():
        note["Front"] = search_text
    if "Back" in note.keys():
        note["Back"] = "Answer"

    collection.add_note(note, deck_id)
    card = collection.get_card(note.card_ids()[0])
    if state in {"review", "suspended"}:
        card.type = CARD_TYPE_REV
        card.queue = QUEUE_TYPE_REV if state == "review" else QUEUE_TYPE_SUSPENDED
        card.due = 1
        collection.update_card(card)
    return int(note.id)


def serialize_note(collection: Collection, note_id: int, fixture_label: str) -> dict[str, Any]:
    note = collection.get_note(note_id)
    notetype = note.note_type()
    fields = {
        field["name"]: {"value": note.fields[field["ord"]], "order": field["ord"]}
        for field in notetype["flds"]
    }
    return {
        "fixtureLabel": fixture_label,
        "noteId": int(note.id),
        "modelName": notetype["name"],
        "tags": note.tags,
        "fields": fields,
    }


def main() -> None:
    request = json.load(sys.stdin)
    query = request["query"]

    with tempfile.TemporaryDirectory(prefix="clanki-anki-search-") as temp_dir:
        collection = Collection(os.path.join(temp_dir, "collection.anki2"))
        try:
            z_deck_id = collection.decks.id("z::fixture")
            outside_deck_id = collection.decks.id("outside::fixture")

            basic = collection.models.by_name("Basic")
            add_fields(collection, basic, VISIBLE_FIELDS + HIDDEN_FIELDS)
            basic = collection.models.by_name("Basic")
            non_basic = create_non_basic_notetype(collection)

            fixtures = {
                "software_review": add_fixture_note(
                    collection, basic, z_deck_id, "zdone:test/SOFTWARE_A_VS_B", "fixtureterm"
                ),
                "historical_review": add_fixture_note(
                    collection,
                    basic,
                    z_deck_id,
                    "zdone:test/HISTORICAL_EVENT_DESCRIPTION_TO_NAME",
                    "fixtureterm",
                ),
                "unrelated_basic": add_fixture_note(
                    collection, basic, z_deck_id, "zdone:test/OTHER_TEMPLATE", "fixtureterm"
                ),
                "underscore_wildcard_lookalike": add_fixture_note(
                    collection, basic, z_deck_id, "zdone:test/SOFTWAREXAXVSXB", "fixtureterm"
                ),
                "allowed_but_new": add_fixture_note(
                    collection, basic, z_deck_id, "zdone:test/SOFTWARE_A_VS_B", "fixtureterm", "new"
                ),
                "allowed_but_suspended": add_fixture_note(
                    collection, basic, z_deck_id, "zdone:test/SOFTWARE_A_VS_B", "fixtureterm", "suspended"
                ),
                "allowed_but_outside_z": add_fixture_note(
                    collection, basic, outside_deck_id, "zdone:test/SOFTWARE_A_VS_B", "fixtureterm"
                ),
                "allowed_but_query_mismatch": add_fixture_note(
                    collection, basic, z_deck_id, "zdone:test/SOFTWARE_A_VS_B", "differentterm"
                ),
                "non_basic_review": add_fixture_note(
                    collection, non_basic, z_deck_id, "custom:test", "fixtureterm"
                ),
                "non_basic_new": add_fixture_note(
                    collection, non_basic, z_deck_id, "custom:new", "fixtureterm", "new"
                ),
            }
            labels_by_note_id = {note_id: label for label, note_id in fixtures.items()}
            matched_notes = [
                serialize_note(collection, int(note_id), labels_by_note_id[int(note_id)])
                for note_id in collection.find_notes(query)
            ]
            json.dump({"notes": matched_notes}, sys.stdout)
        finally:
            collection.close()


if __name__ == "__main__":
    main()
