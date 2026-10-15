"""Static check only: never import or execute the endpoint verification script."""
import ast
from pathlib import Path


def test_verification_assignments_explicitly_use_the_fixture_period():
    source = Path(__file__).resolve().parents[1] / "scripts" / "verify_live_endpoints.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    assignments = [node for node in ast.walk(tree)
                   if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                   and node.func.id == "ClassworkAssignment"]
    assert assignments, "The verification fixture must actually contain an assignment"
    for assignment in assignments:
        keywords = {item.arg: item.value for item in assignment.keywords}
        period = keywords.get("academic_period_id")
        assert isinstance(period, ast.Attribute)
        assert isinstance(period.value, ast.Name) and period.value.id == "q2"
        assert period.attr == "academic_period_id"
