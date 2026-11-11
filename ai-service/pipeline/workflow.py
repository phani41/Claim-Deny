from __future__ import annotations

from typing import Any, Literal

from langgraph.graph import END, START, StateGraph

from llm.client import MalformedModelResponse, ModelCallFailed, ModelNotConfigured
from llm.structured_output import invoke_structured_output
from pipeline.nodes import (
    ClassificationModel,
    DraftPlanModel,
    EvidenceAnalysisModel,
    EvidenceFindingModel,
    GroundingAssessmentModel,
    GroundingReportModel,
    _appeal_drafter_node,
    _classifier_node,
    _evidence_analysis_node,
    _evidence_mapper_node,
    _final_response_node,
    _grounding_validator_node,
    _input_validation_node,
    _read,
)
from pipeline.schemas import AIWorkflowState, WorkflowRequest


def _after_classification(state: Any) -> Literal["classify", "analyze", "generate"]:
    return _read(state, "mode")


def _after_mapping(state: Any) -> Literal["analyze", "generate"]:
    return "analyze" if _read(state, "mode") == "analyze" else "generate"


def build_workflow():
    """Builds and compiles the stateful LangGraph workflow for revenue-cycle claim appeals."""
    graph = StateGraph(AIWorkflowState)
    graph.add_node("input_validation", _input_validation_node)
    graph.add_node("denial_classifier", _classifier_node)
    graph.add_node("evidence_mapper", _evidence_mapper_node)
    graph.add_node("evidence_analysis", _evidence_analysis_node)
    graph.add_node("appeal_drafter", _appeal_drafter_node)
    graph.add_node("grounding_validator", _grounding_validator_node)
    graph.add_node("final_response", _final_response_node)

    graph.add_edge(START, "input_validation")
    graph.add_edge("input_validation", "denial_classifier")
    graph.add_conditional_edges(
        "denial_classifier", _after_classification,
        {"classify": "final_response", "analyze": "evidence_mapper", "generate": "evidence_mapper"},
    )
    graph.add_conditional_edges(
        "evidence_mapper", _after_mapping,
        {"analyze": "final_response", "generate": "evidence_analysis"},
    )
    graph.add_edge("evidence_analysis", "appeal_drafter")
    graph.add_edge("appeal_drafter", "grounding_validator")
    graph.add_edge("grounding_validator", "final_response")
    graph.add_edge("final_response", END)
    return graph.compile()


workflow = build_workflow()


def run_workflow(mode: Literal["classify", "analyze", "generate"], request: WorkflowRequest) -> dict[str, Any]:
    """Executes the compiled LangGraph workflow in the specified operational mode."""
    result = workflow.invoke({"mode": mode, "request": request})
    return result["workflow_result"]

