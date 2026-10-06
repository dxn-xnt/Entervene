"""No database or network: every provider call in these tests is mocked."""
import asyncio
import json
from collections import Counter
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from app.schemas.AITOS import AITOSGenerateRequest, TOSPassage, TOSQuestionIn
from app.services.ai import tos_generation as service
from app.services.ai.question_quality_validation import option_text_issue
from app.services.tos.passage_metadata import encode_question_metadata, decode_question_metadata


def item(number=1, kind="MULTIPLE_CHOICE", level="REMEMBER", **updates):
    options = {"MULTIPLE_CHOICE": ["Root", "Stem", "Leaf", "Flower"], "TRUE_FALSE": ["True", "False"],
               "IDENTIFICATION": ["Root"], "ESSAY": [], "MATCHING": ["Root", "Stem", "Leaf", "Flower"]}[kind]
    data = dict(question_text=f"Plant structure fact {number}.", question_type=kind,
                difficulty_band=service.BANDS[level], cognitive_level=level, points=1.0,
                explanation="A scientifically accurate answer rationale.", options=options,
                correct_index=None if kind == "ESSAY" else 0, passage_id=None)
    return {**data, **updates}


def passage():
    return TOSPassage(id="reading-one", title="The Garden", text=" ".join(["Garden rain supports plants and helps roots grow steadily." * 2] * 10))


@pytest.mark.parametrize("options,rejected", [
    (["Root", " root.", "Leaf", "Flower"], False),
    (["Water cycle", " water   CYCLE! ", "Rain", "Snow"], False),
    (["Root", "Root", "Leaf", "Flower"], True),
])
def test_mc_duplicate_options_preserve_case_and_punctuation(options, rejected):
    assert option_text_issue([{"option_text": text} for text in options]) == ("duplicate options" if rejected else None)
    assert (service.validate_item(item(options=options), "MULTIPLE_CHOICE", None) is None) == rejected


@pytest.mark.parametrize("updates", [
    {"options": ["Root", "Stem"]}, {"options": ["Root", "Stem", "Leaf"]},
    {"options": ["Root", "Stem", "Leaf", "Flower", "Seed"]},
    {"correct_index": 4}, {"correct_index": -1}, {"correct_index": True},
    {"options": ["Root", "Stem", "Leaf", "   "]},
    {"options": [{"option_text": "Root"}] * 4},
])
def test_schema_rejects_invalid_multiple_choice_instead_of_repairing(updates):
    assert service.validate_item(item(**updates), "MULTIPLE_CHOICE", None) is None


@pytest.mark.parametrize("stem", [
    "Analyze the following sentence and select its subject.",
    "Read the passage below and identify the theme.",
    "What is the main idea of the short narrative titled 'The Lost Key'?",
    "Based on the poem above, which line shows imagery?",
])
def test_missing_external_material_is_rejected(stem):
    assert service.supporting_material_issue(stem)
    assert service.validate_item(item(question_text=stem), "MULTIPLE_CHOICE", None) is None


def test_attached_passage_does_not_allow_dangling_ids_or_missing_images():
    source = passage()
    stem = "What is the main idea of the passage?"
    assert service.validate_item(item(question_text=stem, passage_id=source.id), "MULTIPLE_CHOICE", source)
    assert service.validate_item(item(question_text="Standalone fact.", passage_id=None), "MULTIPLE_CHOICE", source) is None
    assert service.validate_item(item(question_text=stem, passage_id="unknown"), "MULTIPLE_CHOICE", source) is None
    assert service.validate_item(item(question_text=stem, passage_id=source.id), "MULTIPLE_CHOICE", None) is None
    assert service.validate_item(item(question_text="Analyze the following image.", passage_id=source.id), "MULTIPLE_CHOICE", source) is None


def test_inline_material_and_standalone_grammar_remain_valid():
    assert service.supporting_material_issue("Read the passage: 'The rain fell all day. Tom stayed inside.' What is the setting?") is None
    assert service.supporting_material_issue("Analyze the following sentence: 'I will go to the store.' What is its subject?") is None
    assert service.supporting_material_issue("Which sentence is a complete sentence?") is None


def test_type_mismatch_and_true_false_pair_order():
    assert service.validate_item(item(), "TRUE_FALSE", None) is None
    q = service.validate_item(item(kind="TRUE_FALSE", options=["False", "True"], correct_index=0), "TRUE_FALSE", None)
    assert [o["option_text"] for o in q["options"]] == ["True", "False"]
    assert q["options"][1]["is_correct"]


def test_blueprint_margins_and_warning_report_only_final_missing_cells():
    targets = service.blueprint_cells({"MULTIPLE_CHOICE": 2, "ESSAY": 1}, {"REMEMBER": 1, "APPLY": 1, "EVALUATE": 1})
    assert sum(targets.values()) == 3
    assert Counter({level: sum(n for (_, lev, _), n in targets.items() if lev == level) for level in service.LEVELS}) == Counter(REMEMBER=1, APPLY=1, EVALUATE=1)
    good = service.validate_item(item(), "MULTIPLE_CHOICE", None)
    assert service.missing_warning("Plants", Counter({("MULTIPLE_CHOICE", "REMEMBER", "EASY"): 2}), [good]) == (
        "TOS question count mismatch for Plants: requested MULTIPLE_CHOICE=2; produced MULTIPLE_CHOICE=1; still missing MULTIPLE_CHOICE/EASY/REMEMBER=1.")


def test_bad_first_pass_repairs_only_missing_cells_and_reaches_target(monkeypatch):
    bad_external = item(2, question_text="Analyze the following sentence.")
    bad_duplicates = item(3, options=["Root", " Root ", "Leaf", "Flower"])
    provider = AsyncMock(side_effect=[json.dumps({"questions": [item(1), bad_external, bad_duplicates]}),
                                      json.dumps({"questions": [item(4, level="APPLY")]} )])
    monkeypatch.setattr(service, "generate_text", provider)
    warnings = []
    result = asyncio.run(service.generate_tos_row_questions("Plant structures", None, "Science", {"MULTIPLE_CHOICE": 2},
                                                            {"REMEMBER": 1, "APPLY": 1}, warnings=warnings))
    assert len(result) == 2 and warnings == []
    assert provider.call_count == 2
    first, repair = [json.loads(call.args[0]) for call in provider.call_args_list]
    assert first["count"] == 3
    assert repair["count"] == 1
    assert repair["missing_blueprint_cells"] == [{"cognitive_level": "APPLY", "difficulty_band": "AVERAGE", "count": 1}]
    assert result[0]["question_text"] in repair["existing_stems_do_not_repeat"]
    assert "REPAIR" in repair["instruction"]
    assert provider.call_args.kwargs["output_schema"]["properties"]["questions"]["items"]["properties"]["options"]["maxItems"] == 4


def test_repair_budget_is_three_and_intermediate_discards_are_not_warnings(monkeypatch):
    provider = AsyncMock(return_value=json.dumps({"questions": [item(options=["Root", "Root", "Stem", "Leaf"])]}))
    monkeypatch.setattr(service, "generate_text", provider)
    warnings = []
    result = asyncio.run(service.generate_tos_row_questions("Plants", None, "Science", {"MULTIPLE_CHOICE": 1}, {"REMEMBER": 1}, warnings=warnings))
    assert result == [] and provider.call_count == 4
    assert warnings == ["TOS question count mismatch for Plants: requested MULTIPLE_CHOICE=1; produced MULTIPLE_CHOICE=0; still missing MULTIPLE_CHOICE/EASY/REMEMBER=1."]


def test_overgeneration_trims_without_relabeling_or_duplicate_stems(monkeypatch):
    provider = AsyncMock(return_value=json.dumps({"questions": [item(1), item(2), item(3)]}))
    monkeypatch.setattr(service, "generate_text", provider)
    result = asyncio.run(service.generate_tos_row_questions("Plants", None, "Science", {"MULTIPLE_CHOICE": 2}, {"REMEMBER": 2}))
    assert len(result) == 2 and provider.call_count == 1
    assert {q["question_type"] for q in result} == {"MULTIPLE_CHOICE"}


def test_passage_generated_before_questions_once_and_reused_in_repairs(monkeypatch):
    calls = []
    source_text = passage().text
    async def provider(prompt, system, **kwargs):
        calls.append((prompt, kwargs))
        schema = kwargs["output_schema"]
        if "id" in schema["properties"]:
            return json.dumps({"id": schema["properties"]["id"]["enum"][0], "title": "The Garden", "text": source_text})
        body = json.loads(prompt)
        return json.dumps({"questions": [item(len(calls), question_text=f"What is the main idea of the passage, question {len(calls)}?", passage_id=body["passage"]["id"])]})
    monkeypatch.setattr(service, "generate_text", provider)
    result = asyncio.run(service.generate_tos_row_questions("Find the main idea", None, "English", {"MULTIPLE_CHOICE": 2}, {"REMEMBER": 2}, grade_level=7))
    assert len(result) == 2 and len(calls) == 3
    assert "Grade: 7" in calls[0][0]
    assert result[0]["passage_id"] == result[1]["passage_id"]
    assert result[0]["passage"]["text"] == source_text


def test_provider_failure_never_enters_content_retry_loop(monkeypatch):
    provider = AsyncMock(side_effect=HTTPException(502, "AI provider could not complete the request."))
    monkeypatch.setattr(service, "generate_text", provider)
    with pytest.raises(HTTPException):
        asyncio.run(service.generate_tos_row_questions("Plants", None, "Science", {"MULTIPLE_CHOICE": 1}, {"REMEMBER": 1}))
    assert provider.call_count == 1


def test_true_false_mix_repair_only_replaces_one_cell(monkeypatch):
    provider = AsyncMock(side_effect=[json.dumps({"questions": [item(n, kind="TRUE_FALSE") for n in range(4)]}),
                                      json.dumps({"questions": [item(5, kind="TRUE_FALSE", correct_index=1)]})])
    monkeypatch.setattr(service, "generate_text", provider)
    result = asyncio.run(service.generate_tos_row_questions("Plants", None, "Science", {"TRUE_FALSE": 3}, {"REMEMBER": 3}))
    assert len(result) == 3 and service.true_false_answers_are_mixed(result)
    assert json.loads(provider.call_args_list[1].args[0])["count"] == 1
    assert json.loads(provider.call_args_list[1].args[0])["required_true_false_answer"] == "False"


def test_passage_metadata_round_trip_and_legacy_explanations_without_db():
    q = TOSQuestionIn(competency_label="Reading", question_text="What is the theme?", question_type="ESSAY",
                      difficulty_band="EASY", cognitive_level="REMEMBER", explanation="Teacher-only rubric",
                      passage=passage(), passage_id=passage().id)
    decoded = decode_question_metadata(encode_question_metadata(q))
    assert decoded == {"explanation": q.explanation, "passage": q.passage, "passage_id": q.passage_id}
    assert decode_question_metadata("Ordinary older rationale") == {"explanation": "Ordinary older rationale", "passage": None, "passage_id": None}
    assert decode_question_metadata("[TOS-PASSAGE:v1]broken")["explanation"] == "[TOS-PASSAGE:v1]broken"


def test_api_orchestrates_twenty_items_in_three_rows_with_mocked_provider_and_db(monkeypatch):
    from app.api.v1.routes import AIAssist as route
    sequence = 0
    async def provider(prompt, system, **kwargs):
        nonlocal sequence
        data = json.loads(prompt)
        candidates = []
        for cell in data["missing_blueprint_cells"]:
            for _ in range(min(cell["count"], data["count"] - len(candidates))):
                sequence += 1
                candidates.append(item(sequence, level=cell["cognitive_level"]))
        if data["repair_round"] == 0:
            for candidate in candidates[1:]:
                candidate["options"] = ["Root", " Root ", "Leaf", "Flower"]
        return json.dumps({"questions": candidates})
    mocked = AsyncMock(side_effect=provider)
    monkeypatch.setattr(service, "generate_text", mocked)
    body = AITOSGenerateRequest(subject_id=1, subject_name="Science", rows=[
        {"competency_id": index, "label": f"Plant topic {index}", "type_counts": {"MULTIPLE_CHOICE": count},
         "bloom_targets": {"REMEMBER": count}} for index, count in enumerate((2, 10, 8), 1)])
    db = Mock()
    db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(subject_name="Science", academic_level=None)
    response = asyncio.run(route.generate_tos_questions(body, "mock-only", db))
    assert len(response.questions) == 20 and response.warnings == []
    assert Counter(q.competency_id for q in response.questions) == {1: 2, 2: 10, 3: 8}
    assert any(json.loads(call.args[0])["repair_round"] > 0 for call in mocked.call_args_list)
    db.commit.assert_not_called()
    db.add.assert_not_called()
    db.execute.assert_not_called()


def test_duplicates_across_rounds_and_existing_exam_stems_are_not_counted(monkeypatch):
    provider = AsyncMock(side_effect=[json.dumps({"questions": [item(1), item(1), item(2)]}),
                                      json.dumps({"questions": [item(3)]})])
    monkeypatch.setattr(service, "generate_text", provider)
    result = asyncio.run(service.generate_tos_row_questions("Plants", None, "Science", {"MULTIPLE_CHOICE": 2},
                                                            {"REMEMBER": 2}, existing_stems=[item(2)["question_text"]]))
    assert [q["question_text"] for q in result] == [item(1)["question_text"], item(3)["question_text"]]
    assert provider.call_count == 2


def test_wrong_cells_are_not_relabelled_and_all_types_have_exact_counts(monkeypatch):
    async def provider(prompt, system, **kwargs):
        body = json.loads(prompt)
        result = []
        for cell in body["missing_blueprint_cells"]:
            for index in range(min(cell["count"], body["count"] - len(result))):
                result.append(item(index, kind=body["question_type"], level=cell["cognitive_level"],
                                   question_text=f"Distinct {body['question_type']} {cell['cognitive_level']} fact {index}."))
        return json.dumps({"questions": result})
    mocked = AsyncMock(side_effect=provider)
    monkeypatch.setattr(service, "generate_text", mocked)
    counts = {"MULTIPLE_CHOICE": 3, "TRUE_FALSE": 2, "IDENTIFICATION": 2, "ESSAY": 1}
    blooms = {"REMEMBER": 3, "UNDERSTAND": 2, "APPLY": 2, "EVALUATE": 1}
    result = asyncio.run(service.generate_tos_row_questions("Plants", None, "Science", counts, blooms))
    assert Counter(q["question_type"] for q in result) == counts
    assert not service.missing_cells(service.blueprint_cells(counts, blooms), result)
    assert service.validate_item(item(level="REMEMBER", difficulty_band="DIFFICULT"), "MULTIPLE_CHOICE", None) is None


def test_invalid_passage_repairs_then_stops_without_generating_unlinked_questions(monkeypatch):
    mocked = AsyncMock(return_value=json.dumps({"id": "wrong-id", "title": "Short", "text": "Too short."}))
    monkeypatch.setattr(service, "generate_text", mocked)
    warnings = []
    result = asyncio.run(service.generate_tos_row_questions("Reading comprehension", None, "English", {"ESSAY": 1},
                                                            {"ANALYZE": 1}, warnings=warnings))
    assert result == [] and mocked.call_count == 4
    assert "ESSAY/AVERAGE/ANALYZE=1" in warnings[0]
    assert all("questions" not in call.kwargs["output_schema"]["properties"] for call in mocked.call_args_list)


def test_single_question_regeneration_reuses_supplied_passage_without_new_source_call(monkeypatch):
    source = passage()
    mocked = AsyncMock(return_value=json.dumps({"questions": [item(1, passage_id=source.id)]}))
    monkeypatch.setattr(service, "generate_text", mocked)
    result = asyncio.run(service.generate_tos_row_questions("Main idea", None, "English", {"MULTIPLE_CHOICE": 1},
                                                            {"REMEMBER": 1}, passage=source))
    assert len(result) == 1 and mocked.call_count == 1
    assert json.loads(mocked.call_args.args[0])["passage"] == source.model_dump()


def test_save_reload_conversion_round_trip_with_mock_db_only():
    from app.services.tos.TOSService import _sync_questions, _question_to_out
    source = passage()
    question = TOSQuestionIn(competency_label="Reading", question_text="What is the main idea?", question_type="ESSAY",
                             difficulty_band="AVERAGE", cognitive_level="ANALYZE", explanation="Original rubric",
                             passage=source, passage_id=source.id)
    db = Mock()
    _sync_questions(db, SimpleNamespace(tos_exam_id=1, questions=[]), [question])
    stored = db.add.call_args.args[0]
    stored.tos_question_id = 2
    restored = _question_to_out(stored)
    assert restored.passage == source and restored.passage_id == source.id
    assert restored.explanation == "Original rubric"
    db.commit.assert_not_called()


def test_true_false_selection_prefers_mixed_validation_reserves_before_paid_repair(monkeypatch):
    provider = AsyncMock(return_value=json.dumps({"questions": [
        item(1, kind="TRUE_FALSE"), item(2, kind="TRUE_FALSE"), item(3, kind="TRUE_FALSE"),
        item(4, kind="TRUE_FALSE", correct_index=1),
    ]}))
    monkeypatch.setattr(service, "generate_text", provider)
    result = asyncio.run(service.generate_tos_row_questions("Plants", None, "Science", {"TRUE_FALSE": 3}, {"REMEMBER": 3}))
    assert len(result) == 3 and service.true_false_answers_are_mixed(result)
    assert provider.call_count == 1


def test_each_repair_prompt_has_a_unique_round_to_avoid_metering_duplicate_block(monkeypatch):
    provider = AsyncMock(return_value="not JSON")
    monkeypatch.setattr(service, "generate_text", provider)
    asyncio.run(service.generate_tos_row_questions("Plants", None, "Science", {"MULTIPLE_CHOICE": 1}, {"REMEMBER": 1}))
    prompts = [call.args[0] for call in provider.call_args_list]
    assert len(set(prompts)) == 4
    assert [json.loads(prompt)["repair_round"] for prompt in prompts] == [0, 1, 2, 3]


@pytest.mark.parametrize("kind,reserve", [("MULTIPLE_CHOICE", 250), ("TRUE_FALSE", 150),
    ("IDENTIFICATION", 130), ("ESSAY", 250), ("MATCHING", 200)])
@pytest.mark.parametrize("batch_count", range(1, 7))
def test_completion_budget_defaults_per_type_and_batch(kind, reserve, batch_count):
    assert service.completion_budget(kind, batch_count) == 300 + batch_count * reserve


def test_completion_budget_settings_override_and_fixed_ceiling(monkeypatch):
    from app.core.Config import Settings
    monkeypatch.setenv("TOS_COMPLETION_BASE_TOKENS", "400")
    monkeypatch.setenv("TOS_COMPLETION_ESSAY_PER_ITEM", "700")
    configured = Settings(_env_file=None)
    monkeypatch.setattr(service, "settings", configured)
    assert service.completion_budget("ESSAY", 2) == 1800
    assert service.completion_budget("ESSAY", 6) == 4000
    assert service.completion_budget("ESSAY", 100) == 4000
    assert service.completion_budget("TRUE_FALSE", 1) == 550
    assert service.legacy_completion_budget(100) == 4000


@pytest.mark.parametrize("field,value", [("tos_completion_base_tokens", -1),
    ("tos_completion_base_tokens", 4001), ("tos_completion_mc_per_item", 0),
    ("tos_completion_tf_per_item", -1), ("tos_completion_identification_per_item", 4001),
    ("tos_completion_essay_per_item", 0), ("tos_completion_matching_per_item", 0)])
def test_completion_budget_settings_reject_invalid_reserves(field, value):
    from app.core.Config import Settings
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{field: value})


@pytest.mark.parametrize("kind,reserve", [("MULTIPLE_CHOICE", 250), ("TRUE_FALSE", 150),
    ("IDENTIFICATION", 130), ("ESSAY", 250), ("MATCHING", 200)])
def test_first_pass_and_repair_use_the_same_per_type_budget(monkeypatch, kind, reserve):
    mocked = AsyncMock(side_effect=[json.dumps({"questions": []}), json.dumps({"questions": [item(kind=kind)]})])
    monkeypatch.setattr(service, "generate_text", mocked)
    result = asyncio.run(service.generate_tos_row_questions("Plant structures", None, "Science", {kind: 1}, {"REMEMBER": 1}))
    assert len(result) == 1
    assert [call.kwargs["max_tokens"] for call in mocked.call_args_list] == [300 + 2 * reserve, 300 + reserve]
    assert [json.loads(call.args[0])["repair_round"] for call in mocked.call_args_list] == [0, 1]


@pytest.mark.parametrize("failure", ["finish_reason", "cut_json"])
@pytest.mark.parametrize("round_number", [0, 2])
def test_batch_truncation_retries_once_without_consuming_repairs(monkeypatch, caplog, failure, round_number):
    from app.services.ai.provider_diagnostics import ProviderTruncationError, current_truncation_retry, current_call
    metrics = service.RowMetrics(repair_rounds=round_number)
    calls = []
    async def generate(prompt, system, **kwargs):
        calls.append((prompt, system, kwargs, current_call.get(), current_truncation_retry.get()))
        if len(calls) == 1:
            if failure == "finish_reason":
                raise ProviderTruncationError()
            return '{"questions":[{"question_text":"cut off'
        return json.dumps({"questions": [item(kind="ESSAY")]})
    monkeypatch.setattr(service, "generate_text", generate)
    caplog.set_level("INFO", logger="ai.tos.telemetry")
    raw = asyncio.run(service._generate_question_batch("PRIVATE PROMPT", "ESSAY", 6, None, round_number, 6, metrics))
    assert len(json.loads(raw)["questions"]) == 1
    assert [call[2]["max_tokens"] for call in calls] == [1800, 3600]
    assert calls[0][:2] == calls[1][:2]
    assert calls[0][2]["output_schema"] == calls[1][2]["output_schema"]
    assert calls[0][3] == calls[1][3] and [call[4] for call in calls] == [False, True]
    assert metrics.truncation_retries == 1 and metrics.repair_rounds == round_number and not metrics.discards
    assert "TOS_TRUNCATION_RETRY" in caplog.text and "PRIVATE PROMPT" not in caplog.text
    assert not current_truncation_retry.get()


def test_two_cut_json_results_do_not_retry_batch_a_third_time(monkeypatch):
    truncated = '{"questions":['
    mocked = AsyncMock(return_value=truncated)
    monkeypatch.setattr(service, "generate_text", mocked)
    metrics = service.RowMetrics()
    raw = asyncio.run(service._generate_question_batch("mock", "ESSAY", 6, None, 0, 0, metrics))
    assert raw == truncated and mocked.await_count == 2
    assert metrics.truncation_retries == 1 and metrics.repair_rounds == 0 and not metrics.discards
    assert service._read_questions(raw, metrics.discards) == []
    assert metrics.discards == {"invalid_json": 1}


def test_two_finish_reason_truncations_stop_after_one_fallback(monkeypatch):
    from app.services.ai.provider_diagnostics import ProviderTruncationError
    mocked = AsyncMock(side_effect=ProviderTruncationError())
    monkeypatch.setattr(service, "generate_text", mocked)
    metrics = service.RowMetrics()
    with pytest.raises(HTTPException) as exc:
        asyncio.run(service._generate_question_batch("mock", "ESSAY", 6, None, 0, 0, metrics))
    assert exc.value.status_code == 502
    assert mocked.await_count == 2 and metrics.truncation_retries == 1 and metrics.repair_rounds == 0


def test_non_truncation_provider_error_does_not_get_budget_fallback(monkeypatch):
    mocked = AsyncMock(side_effect=HTTPException(429, "AI is busy"))
    monkeypatch.setattr(service, "generate_text", mocked)
    metrics = service.RowMetrics()
    with pytest.raises(HTTPException):
        asyncio.run(service._generate_question_batch("mock", "ESSAY", 6, None, 0, 0, metrics))
    assert mocked.await_count == 1 and metrics.truncation_retries == 0


def test_valid_reserves_and_wrong_blueprint_cells_have_distinct_discard_counts(monkeypatch):
    from app.services.ai.tos_generation_session import ExamGeneration, current_generation
    op = ExamGeneration("mock-only", Counter(MULTIPLE_CHOICE=2))
    mocked = AsyncMock(side_effect=[json.dumps({"questions": [item(1), item(2), item(3, level="EVALUATE")]}),
                                   json.dumps({"questions": [item(4, level="APPLY"), item(5, level="APPLY")]} )])
    monkeypatch.setattr(service, "generate_text", mocked)
    async def run():
        token = current_generation.set(op)
        try:
            return await service.generate_tos_row_questions("Plants", None, "Science", {"MULTIPLE_CHOICE": 2},
                                                           {"REMEMBER": 1, "APPLY": 1})
        finally:
            current_generation.reset(token)
    assert len(asyncio.run(run())) == 2
    # Extra Remember while Apply remains missing, and an unrequested Evaluate
    # cell, are blueprint mismatches rather than exact-target trimming.
    assert op.summary()["other_validation_reasons"] == {"surplus_cell": 2}
    # Both repair candidates now go through validation/selection: the second
    # valid Apply reserve is trimmed, not silently sliced off before validation.
    assert op.summary()["discard_counts"]["trimmed_over_target"] == 1
    assert op.summary()["final_per_type"] == {"MULTIPLE_CHOICE": 0}  # Exam-level completion belongs to its caller.
    assert op.rows[0].final == Counter(MULTIPLE_CHOICE=2)
    mocked.return_value = json.dumps({"questions": [item(1), item(2), item(3)]})
    mocked.side_effect = None
    op.rows.clear()
    async def full():
        token = current_generation.set(op)
        try:
            return await service.generate_tos_row_questions("Plants", None, "Science", {"MULTIPLE_CHOICE": 2}, {"REMEMBER": 2})
        finally:
            current_generation.reset(token)
    assert len(asyncio.run(full())) == 2
    assert op.summary()["discard_counts"] == {"external_material": 0, "duplicate_options": 0,
                                              "trimmed_over_target": 1, "other_validation": 0}


def test_duplicate_stem_labels_distinguish_kept_questions_and_batch_candidates(monkeypatch):
    from app.services.ai.tos_generation_session import ExamGeneration, current_generation
    op = ExamGeneration("mock-only", Counter(MULTIPLE_CHOICE=2))
    mocked = AsyncMock(side_effect=[json.dumps({"questions": [item(1), item(1), item(2)]}),
                                   json.dumps({"questions": [item(3)]})])
    monkeypatch.setattr(service, "generate_text", mocked)
    async def run():
        token = current_generation.set(op)
        try:
            return await service.generate_tos_row_questions("Plants", None, "Science", {"MULTIPLE_CHOICE": 2},
                                                           {"REMEMBER": 2}, existing_stems=[item(2)["question_text"]])
        finally:
            current_generation.reset(token)
    result = asyncio.run(run())
    assert [q["question_text"] for q in result] == [item(1)["question_text"], item(3)["question_text"]]
    assert op.summary()["duplicate_stem_counts"] == {"existing_kept": 1, "same_batch": 1, "previous_candidate": 0}


def test_duplicate_against_previous_batch_kept_question_is_not_same_batch(monkeypatch):
    from app.services.ai.tos_generation_session import ExamGeneration, current_generation
    op = ExamGeneration("mock-only", Counter(MULTIPLE_CHOICE=2))
    mocked = AsyncMock(side_effect=[json.dumps({"questions": [item(1)]}),
        json.dumps({"questions": [item(1)]}), json.dumps({"questions": [item(2)]})])
    monkeypatch.setattr(service, "generate_text", mocked)
    async def run():
        token = current_generation.set(op)
        try:
            return await service.generate_tos_row_questions("Plants", None, "Science", {"MULTIPLE_CHOICE": 2}, {"REMEMBER": 2})
        finally:
            current_generation.reset(token)
    assert len(asyncio.run(run())) == 2
    assert op.summary()["duplicate_stem_counts"] == {"existing_kept": 1, "same_batch": 0, "previous_candidate": 0}


def test_repeat_of_unkept_candidate_is_labelled_without_changing_deduplication(monkeypatch):
    from app.services.ai.tos_generation_session import ExamGeneration, current_generation
    op = ExamGeneration("mock-only", Counter(MULTIPLE_CHOICE=2))
    mocked = AsyncMock(side_effect=[json.dumps({"questions": [item(1), item(2), item(3, level="APPLY")]}),
        json.dumps({"questions": [item(2, level="APPLY")]}), json.dumps({"questions": [item(4, level="APPLY")]})])
    monkeypatch.setattr(service, "generate_text", mocked)
    async def run():
        token = current_generation.set(op)
        try:
            return await service.generate_tos_row_questions("Plants", None, "Science", {"MULTIPLE_CHOICE": 2},
                                                           {"REMEMBER": 1, "APPLY": 1}, existing_stems=[item(3)["question_text"]])
        finally:
            current_generation.reset(token)
    assert len(asyncio.run(run())) == 2
    assert op.summary()["duplicate_stem_counts"] == {"existing_kept": 1, "same_batch": 0, "previous_candidate": 1}


@pytest.mark.parametrize("missing_only", [False, True])
def test_mc_distinct_misconception_checklist_in_initial_and_repair_without_shape_changes(monkeypatch, missing_only):
    first = item(1, question_text="Which sentence type states a fact?",
                 options=["Declarative", "Interrogative", "Imperative", "Exclamatory"])
    bad = item(2, level="APPLY", options=["Declarative", " Declarative ", "Imperative", "Exclamatory"])
    repaired = item(3, level="APPLY", question_text="A speaker asks for information. Which sentence type is used?",
                    options=["Declarative", "Interrogative", "Imperative", "Exclamatory"], correct_index=1)
    mocked = AsyncMock(side_effect=[json.dumps({"questions": [first, bad]}),
                                   json.dumps({"questions": [repaired]})])
    monkeypatch.setattr(service, "generate_text", mocked)
    warnings = []
    questions = asyncio.run(service.generate_tos_row_questions("Identify sentence types and punctuation", None,
        "English", {"MULTIPLE_CHOICE": 2}, {"REMEMBER": 1, "APPLY": 1},
        warnings=warnings, missing_only=missing_only))
    assert len(questions) == 2 and warnings == [] and mocked.await_count == 2
    initial, repair = [json.loads(call.args[0]) for call in mocked.call_args_list]
    assert initial["repair_round"] == 0 and repair["repair_round"] == 1
    assert initial["count"] == (2 if missing_only else 3) and repair["count"] == 1
    assert initial["instruction"].startswith("REPAIR:" if missing_only else "INITIAL:")
    assert repair["instruction"].startswith("REPAIR:")
    for body in (initial, repair):
        assert service.MC_DISTRACTOR_CHECKLIST in body["instruction"]
        assert "Each of the three distractors must reflect a distinct error type or misconception" in body["instruction"]
        assert "Do not reuse the same error type or misconception across distractors" in body["instruction"]
        assert "silent" not in body["instruction"].lower()
        assert set(body) == {"subject", "grade_level", "language", "competency", "code", "question_type",
            "count", "missing_blueprint_cells", "repair_round", "batch_offset", "passage",
            "existing_stems_do_not_repeat", "instruction", "required_true_false_answer"}
    for call in mocked.call_args_list:
        assert call.args[1] == service.SYSTEM_PROMPT
        schema = call.kwargs["output_schema"]["properties"]["questions"]
        assert schema["minItems"] == 1 and schema["maxItems"] == 100
        properties = schema["items"]["properties"]
        assert set(properties) == {"question_text", "cognitive_level", "difficulty_band", "points",
                                   "explanation", "options", "correct_index"}
        assert set(schema["items"]["required"]) == set(properties)
        assert properties["options"] == {"type": "array", "items": {"type": "string"}, "minItems": 4, "maxItems": 4}
        assert properties["correct_index"] == {"type": "integer", "minimum": 0, "maximum": 3}
    assert mocked.call_args_list[0].kwargs["output_schema"] == mocked.call_args_list[1].kwargs["output_schema"]
    assert [call.kwargs["max_tokens"] for call in mocked.call_args_list] == [800 if missing_only else 1050, 550]
    assert repair["existing_stems_do_not_repeat"] == [first["question_text"], bad["question_text"]]
    for q, answer in zip(questions, ("Declarative", "Interrogative")):
        assert set(q) == {"question_text", "question_type", "cognitive_level", "difficulty_band", "points",
                          "explanation", "options", "passage_id", "passage"}
        assert q["question_type"] == "MULTIPLE_CHOICE" and q["passage_id"] is None and q["passage"] is None
        assert len(q["options"]) == 4 and sum(o["is_correct"] for o in q["options"]) == 1
        assert next(o["option_text"] for o in q["options"] if o["is_correct"]) == answer
        assert [o["option_order"] for o in q["options"]] == [1, 2, 3, 4]
        assert all(set(o) == {"option_text", "is_correct", "option_order"} for o in q["options"])


@pytest.mark.parametrize("kind", ["TRUE_FALSE", "IDENTIFICATION", "ESSAY", "MATCHING"])
def test_mc_checklist_is_not_added_to_other_type_initial_or_repair_prompts(monkeypatch, kind):
    mocked = AsyncMock(side_effect=[json.dumps({"questions": [item(kind=kind, points="1")]}),
                                   json.dumps({"questions": [item(2, kind=kind)]})])
    monkeypatch.setattr(service, "generate_text", mocked)
    questions = asyncio.run(service.generate_tos_row_questions("Plant structures", None, "Science",
        {kind: 1}, {"REMEMBER": 1}))
    assert len(questions) == 1 and mocked.await_count == 2
    initial, repair = [json.loads(call.args[0]) for call in mocked.call_args_list]
    assert initial["repair_round"] == 0 and repair["repair_round"] == 1
    assert initial["instruction"].startswith("INITIAL:") and repair["instruction"].startswith("REPAIR:")
    assert all(service.MC_DISTRACTOR_CHECKLIST not in body["instruction"] for body in (initial, repair))


@pytest.mark.parametrize("stem,options,reason", [
    ("Which sentence correctly capitalizes the person's name?",
     ["Tom went home.", "tom went home.", "TOM went home.", "tom Went home."], None),
    ("Which sentence has the correct terminal punctuation for a command?",
     ["Stop.", "Stop?", "Stop!", "Stop"], None),
    ("Which punctuation mark ends a direct question?", [".", "?", "!", ";"], "empty_option"),
    ("Which sentence uses a comma to address Grandma?",
     ["Let us eat, Grandma.", "Let us eat Grandma.", "Let, us eat Grandma.", "Let us, eat Grandma."], None),
    ("Which punctuation mark ends a direct question?",
     ["Period", "Question mark", "Exclamation point", "Comma"], None),
])
def test_grammar_duplicate_rule_preserves_case_punctuation_and_other_validation(stem, options, reason):
    discards = Counter()
    question = service.validate_item(item(question_text=stem, options=options), "MULTIPLE_CHOICE", None,
                                     discards=discards)
    assert (question is None) == (reason is not None)
    assert discards == (Counter({reason: 1}) if reason else Counter())
