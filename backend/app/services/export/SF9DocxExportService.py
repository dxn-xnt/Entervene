from __future__ import annotations

import io
from typing import Any
from sqlalchemy.orm import Session

import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.enum.section import WD_ORIENT
from docx.oxml import parse_xml, OxmlElement
from docx.oxml.ns import nsdecls, qn

from app.services.export.SF9ExportService import (
    gather_student_sf9_data,
    gather_advisory_class_sf9_batch_data,
)


COLOR_BLACK = "000000"
COLOR_GRAY = "666666"
COLOR_LIGHT_GRAY = "F2F2F2"
COLOR_HEADER_BG = "E8EEF5"
FONT_NAME = "Calibri"


def _set_cell_border(cell: Any, **kwargs: dict[str, Any]) -> None:
    """Set custom borders for a table cell."""
    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = parse_xml(f'<w:tcBorders {nsdecls("w")}/>')
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        edge_data = kwargs.get(edge)
        if edge_data:
            tag = f"w:{edge}"
            element = parse_xml(
                f'<{tag} {nsdecls("w")} w:val="{edge_data.get("val", "single")}" '
                f'w:sz="{edge_data.get("sz", 4)}" w:space="0" '
                f'w:color="{edge_data.get("color", "000000")}"/>'
            )
            tcBorders.append(element)
    tcPr.append(tcBorders)


def _set_cell_background(cell: Any, hex_color: str) -> None:
    """Set background shading for a table cell."""
    tcPr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>')
    tcPr.append(shd)


def _set_cell_margins(cell: Any, top: int = 40, bottom: int = 40, left: int = 60, right: int = 60) -> None:
    """Set cell internal margins in twips (dxa)."""
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(
        f'<w:tcMar {nsdecls("w")}>'
        f'<w:top w:w="{top}" w:type="dxa"/>'
        f'<w:bottom w:w="{bottom}" w:type="dxa"/>'
        f'<w:left w:w="{left}" w:type="dxa"/>'
        f'<w:right w:w="{right}" w:type="dxa"/>'
        f'</w:tcMar>'
    )
    tcPr.append(tcMar)


def _add_p(
    container: Any,
    text: str = "",
    *,
    bold: bool = False,
    italic: bool = False,
    size: float = 8.5,
    align: WD_ALIGN_PARAGRAPH = WD_ALIGN_PARAGRAPH.LEFT,
    space_before: float = 0,
    space_after: float = 2,
    line_spacing: float = 1.0,
    color: str | None = None,
) -> Any:
    """Helper to add a styled paragraph to a cell or document."""
    p = container.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = line_spacing

    if text:
        run = p.add_run(text)
        run.bold = bold
        run.italic = italic
        run.font.name = FONT_NAME
        run.font.size = Pt(size)
        if color:
            r = int(color[0:2], 16)
            g = int(color[2:4], 16)
            b = int(color[4:6], 16)
            run.font.color.rgb = RGBColor(r, g, b)
    return p


def render_student_sf9_docx(
    doc: docx.Document,
    data: dict[str, Any],
    comments: dict[str, str] | None = None,
) -> None:
    """Render a single student's SF9 2-column landscape report card into the Word document."""
    comments = comments or {}
    school = data["school_info"]
    student = data["student"]
    class_info = data["class_info"]
    periods = data["periods"]
    learning_areas = data["learning_areas"]
    gwa_info = data["general_average"]
    attendance = data["attendance"]
    descriptors = data["descriptors"]

    # 1. Outer Master Table: 1 row, 2 columns (Left column 5.0 in, Right column 5.0 in)
    master_tbl = doc.add_table(rows=1, cols=2)
    master_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    master_tbl.autofit = False

    # Widths
    col_w = Inches(5.1)
    for row in master_tbl.rows:
        row.cells[0].width = col_w
        row.cells[1].width = col_w

    left_cell = master_tbl.cell(0, 0)
    right_cell = master_tbl.cell(0, 1)

    # Style cells: add right divider border on left cell or left divider on right cell
    _set_cell_margins(left_cell, top=0, bottom=0, left=40, right=80)
    _set_cell_margins(right_cell, top=0, bottom=0, left=80, right=40)
    _set_cell_border(right_cell, left={"val": "single", "sz": 6, "color": "333333"})

    # Clear default empty paragraph in cells
    left_cell._element.remove(left_cell.paragraphs[0]._element)
    right_cell._element.remove(right_cell.paragraphs[0]._element)

    # ══════════════════════════════════════════════════════════════════════
    # LEFT COLUMN: Learner's Performance Report
    # ══════════════════════════════════════════════════════════════════════

    # Header block
    _add_p(left_cell, "Republic of the Philippines", size=7.5, italic=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=0.5)
    _add_p(left_cell, "Department of Education", size=8.5, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=0.5)
    _add_p(left_cell, f"{school.get('region', 'Region I')}", size=8, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=0.5)
    _add_p(left_cell, f"SCHOOLS DIVISION OFFICE OF {school.get('division', '').upper()}", size=8, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=0.5)
    _add_p(left_cell, f"District {school.get('district', '')}", size=7.5, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=0.5)
    _add_p(left_cell, f"{school.get('municipality', 'Municipality/City, Province')}", size=7.5, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=3)

    # School line
    _add_p(left_cell, f"School:  {school['school_name']}", size=8, bold=True, space_after=3)

    # Report Title
    _add_p(left_cell, "LEARNER'S PERFORMANCE REPORT", size=9.5, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=1)
    _add_p(left_cell, f"School Year {class_info['academic_year']}", size=8, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)

    # Student metadata table (borderless)
    meta_tbl = left_cell.add_table(rows=3, cols=3)
    meta_tbl.autofit = False
    for r in meta_tbl.rows:
        r.cells[0].width = Inches(2.7)
        r.cells[1].width = Inches(1.1)
        r.cells[2].width = Inches(1.3)

    # Row 1: Name, Age, Sex
    r0 = meta_tbl.rows[0]
    p = r0.cells[0].paragraphs[0]
    p.paragraph_format.space_after = Pt(1)
    p.add_run("Name: ").bold = True
    p.add_run(student["full_name"])

    p = r0.cells[1].paragraphs[0]
    p.paragraph_format.space_after = Pt(1)
    p.add_run("Age: ").bold = True
    p.add_run(str(student["age"]) if student["age"] is not None else "-")

    p = r0.cells[2].paragraphs[0]
    p.paragraph_format.space_after = Pt(1)
    p.add_run("Sex: ").bold = True
    p.add_run(student["gender"] or "-")

    # Row 2: LRN, Grade, Section
    r1 = meta_tbl.rows[1]
    p = r1.cells[0].paragraphs[0]
    p.paragraph_format.space_after = Pt(1)
    p.add_run("LRN: ").bold = True
    p.add_run(student["student_lrn"] or "-")

    p = r1.cells[1].paragraphs[0]
    p.paragraph_format.space_after = Pt(1)
    p.add_run("Grade: ").bold = True
    p.add_run(class_info["grade_level"])

    p = r1.cells[2].paragraphs[0]
    p.paragraph_format.space_after = Pt(1)
    p.add_run("Section: ").bold = True
    p.add_run(class_info["section_name"])

    # Row 3: Track (SHS only)
    r2 = meta_tbl.rows[2]
    p = r2.cells[0].paragraphs[0]
    p.paragraph_format.space_after = Pt(3)
    p.add_run("Track (SHS only): ").bold = True
    p.add_run(student.get("track") or "General / Core")

    # Dear Parents Note
    _add_p(left_cell, "Dear Parents,", size=8, bold=True, space_before=2, space_after=1)
    _add_p(
        left_cell,
        "    This Performance Report shows the ability and progress your child has made in the different learning areas as well as his/her core values.\n"
        "    The school welcomes you should you desire to know more about your child's progress.",
        size=7.5,
        space_after=4,
        line_spacing=1.05,
    )

    # LEARNING PROGRESS AND ACHIEVEMENT Table
    _add_p(left_cell, "LEARNING PROGRESS AND ACHIEVEMENT", size=8.5, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)

    # Determine period columns
    num_p = max(1, len(periods))
    # Cols: 0: Learning Area, 1..num_p: Terms, num_p+1: Final Grade, num_p+2: Remarks
    num_grade_cols = 1 + num_p + 2
    grades_tbl = left_cell.add_table(rows=2, cols=num_grade_cols)
    grades_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    grades_tbl.autofit = False

    # Column widths: Learning Area: 2.2 in, Terms: 0.5 in each, Final Grade: 0.7 in, Remarks: 0.7 in
    la_w = Inches(2.3)
    term_w = Inches(0.48)
    fg_w = Inches(0.65)
    rem_w = Inches(0.65)

    for row in grades_tbl.rows:
        row.cells[0].width = la_w
        for idx in range(num_p):
            row.cells[1 + idx].width = term_w
        row.cells[num_p + 1].width = fg_w
        row.cells[num_p + 2].width = rem_w

    # Table Header Row 0 & 1
    # Cell (0, 0): Learning Areas (merged vertically)
    grades_tbl.cell(0, 0).merge(grades_tbl.cell(1, 0))
    p = grades_tbl.cell(0, 0).paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run("Learning Areas").bold = True
    p.runs[0].font.size = Pt(7.5)

    # Cell (0, 1) to (0, num_p): TERM header merged horizontally
    term_master = grades_tbl.cell(0, 1)
    for idx in range(1, num_p):
        term_master.merge(grades_tbl.cell(0, 1 + idx))
    p = term_master.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run("TERM").bold = True
    p.runs[0].font.size = Pt(7.5)

    # Sub-headers for terms in row 1
    for idx, per in enumerate(periods):
        cell = grades_tbl.cell(1, 1 + idx)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run(str(per.get("period_sequence", idx + 1))).bold = True
        p.runs[0].font.size = Pt(7.5)

    # Final Grade header
    grades_tbl.cell(0, num_p + 1).merge(grades_tbl.cell(1, num_p + 1))
    p = grades_tbl.cell(0, num_p + 1).paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run("Final\nGrade").bold = True
    p.runs[0].font.size = Pt(7.5)

    # Remarks header
    grades_tbl.cell(0, num_p + 2).merge(grades_tbl.cell(1, num_p + 2))
    p = grades_tbl.cell(0, num_p + 2).paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run("Remarks").bold = True
    p.runs[0].font.size = Pt(7.5)

    # Style header cells
    for r_idx in range(2):
        for c in grades_tbl.rows[r_idx].cells:
            _set_cell_border(c, top={"sz": 4}, bottom={"sz": 4}, left={"sz": 4}, right={"sz": 4})
            _set_cell_margins(c, top=20, bottom=20, left=30, right=30)
            _set_cell_background(c, COLOR_HEADER_BG)

    # Helper to add a grade row
    def add_subject_row(subj_item: dict[str, Any], is_section_header: bool = False) -> None:
        row = grades_tbl.add_row()
        for idx in range(num_grade_cols):
            c = row.cells[idx]
            _set_cell_border(c, top={"sz": 3}, bottom={"sz": 3}, left={"sz": 3}, right={"sz": 3})
            _set_cell_margins(c, top=20, bottom=20, left=30, right=30)

        if is_section_header:
            row.cells[0].merge(row.cells[num_grade_cols - 1])
            p = row.cells[0].paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            r = p.add_run(subj_item["subject_name"])
            r.bold = True
            r.font.size = Pt(7.5)
            _set_cell_background(row.cells[0], COLOR_LIGHT_GRAY)
            return

        # Regular subject row
        p = row.cells[0].paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        r = p.add_run(subj_item["subject_name"])
        r.font.size = Pt(7)

        # Term grades
        for p_idx, per in enumerate(periods):
            seq_key = str(per.get("period_sequence", p_idx + 1))
            val = subj_item["grades"].get(seq_key)
            val_str = f"{val:.0f}" if (val is not None and val == int(val)) else (f"{val:.1f}" if val is not None else "")
            p_cell = row.cells[1 + p_idx].paragraphs[0]
            p_cell.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p_cell.add_run(val_str).font.size = Pt(7)

        # Final Grade
        fg_val = subj_item.get("final_grade")
        fg_str = f"{fg_val:.0f}" if (fg_val is not None and fg_val == int(fg_val)) else (f"{fg_val:.1f}" if fg_val is not None else "")
        p_fg = row.cells[num_p + 1].paragraphs[0]
        p_fg.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r_fg = p_fg.add_run(fg_str)
        r_fg.bold = True
        r_fg.font.size = Pt(7)

        # Remarks
        p_rem = row.cells[num_p + 2].paragraphs[0]
        p_rem.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r_rem = p_rem.add_run(subj_item.get("remarks") or "")
        r_rem.font.size = Pt(7)

    # Add Core Subjects
    core_list = learning_areas.get("core") or []
    if core_list:
        add_subject_row({"subject_name": "Core Subjects"}, is_section_header=True)
        for s in core_list:
            add_subject_row(s)

    # Add Electives
    elective_list = learning_areas.get("electives") or []
    if elective_list:
        add_subject_row({"subject_name": "Elective Subjects"}, is_section_header=True)
        for s in elective_list:
            add_subject_row(s)

    # Add General Average Row
    gwa_row = grades_tbl.add_row()
    for idx in range(num_grade_cols):
        c = gwa_row.cells[idx]
        _set_cell_border(c, top={"sz": 4}, bottom={"sz": 6, "val": "double"}, left={"sz": 4}, right={"sz": 4})
        _set_cell_margins(c, top=20, bottom=20, left=30, right=30)
        _set_cell_background(c, "FFF8DC")

    # Merge Learning Area and Term cells for GWA label
    gwa_label_cell = gwa_row.cells[0]
    for idx in range(1, num_p + 1):
        gwa_label_cell.merge(gwa_row.cells[idx])

    p = gwa_label_cell.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = p.add_run("General Average ")
    r.bold = True
    r.font.size = Pt(7.5)

    gwa_val = gwa_info.get("final_rating")
    gwa_str = f"{gwa_val:.1f}" if gwa_val is not None else ""
    p_gwa = gwa_row.cells[num_p + 1].paragraphs[0]
    p_gwa.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_gwa = p_gwa.add_run(gwa_str)
    r_gwa.bold = True
    r_gwa.font.size = Pt(7.5)

    p_gwa_rem = gwa_row.cells[num_p + 2].paragraphs[0]
    p_gwa_rem.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r_gwa_rem = p_gwa_rem.add_run(gwa_info.get("remarks") or "")
    r_gwa_rem.bold = True
    r_gwa_rem.font.size = Pt(7.5)

    # PERFORMANCE DESCRIPTORS Section
    _add_p(left_cell, "PERFORMANCE DESCRIPTORS", size=8, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_before=4, space_after=1)
    desc_tbl = left_cell.add_table(rows=1 + len(descriptors), cols=3)
    desc_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    desc_tbl.autofit = False

    desc_col_ws = [Inches(1.5), Inches(1.8), Inches(1.4)]
    for row in desc_tbl.rows:
        for idx in range(3):
            row.cells[idx].width = desc_col_ws[idx]

    # Header
    for idx, title in enumerate(["Grading Scale", "Description", "Remarks"]):
        c = desc_tbl.cell(0, idx)
        _set_cell_border(c, top={"sz": 4}, bottom={"sz": 4})
        _set_cell_margins(c, top=10, bottom=10, left=20, right=20)
        p = c.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(title)
        r.bold = True
        r.font.size = Pt(7)

    for idx, d in enumerate(descriptors):
        row = desc_tbl.rows[idx + 1]
        for c_idx, val in enumerate([d["scale"], d["description"], d["remarks"]]):
            c = row.cells[c_idx]
            _set_cell_margins(c, top=10, bottom=10, left=20, right=20)
            p = c.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r = p.add_run(val)
            r.font.size = Pt(6.5)


    # ══════════════════════════════════════════════════════════════════════
    # RIGHT COLUMN: Attendance, Remarks, Signatures, Transfer
    # ══════════════════════════════════════════════════════════════════════

    # 1. ATTENDANCE RECORD
    _add_p(right_cell, "ATTENDANCE RECORD", size=9, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)

    att_months = attendance["months"]
    # Total cols = 1 (label) + len(months) + 1 (Total)
    num_att_cols = 1 + len(att_months) + 1
    att_tbl = right_cell.add_table(rows=4, cols=num_att_cols)
    att_tbl.alignment = WD_TABLE_ALIGNMENT.CENTER
    att_tbl.autofit = False

    # Widths: label 1.3 in, months 0.28 in each, total 0.45 in
    lbl_w = Inches(1.3)
    m_w = Inches(0.29)
    tot_w = Inches(0.45)

    for row in att_tbl.rows:
        row.cells[0].width = lbl_w
        for idx in range(len(att_months)):
            row.cells[1 + idx].width = m_w
        row.cells[num_att_cols - 1].width = tot_w

    # Row 0: Month labels
    att_tbl.cell(0, 0).paragraphs[0].add_run("Month").bold = True
    att_tbl.cell(0, 0).paragraphs[0].runs[0].font.size = Pt(6.5)
    att_tbl.cell(0, 0).paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

    for idx, m in enumerate(att_months):
        c = att_tbl.cell(0, 1 + idx)
        p = c.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(m["month"])
        r.bold = True
        r.font.size = Pt(6)

    c_tot = att_tbl.cell(0, num_att_cols - 1)
    p = c_tot.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("Total")
    r.bold = True
    r.font.size = Pt(6.5)

    # Row 1: No. of Class Days
    att_tbl.cell(1, 0).paragraphs[0].add_run("No. of Class Days").font.size = Pt(6)
    for idx, m in enumerate(att_months):
        p = att_tbl.cell(1, 1 + idx).paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run(str(m["class_days"]) if m["class_days"] else "").font.size = Pt(6)
    p = att_tbl.cell(1, num_att_cols - 1).paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run(str(attendance["total"]["class_days"]) if attendance["total"]["class_days"] else "").font.size = Pt(6)

    # Row 2: No. of Days Present
    att_tbl.cell(2, 0).paragraphs[0].add_run("No. of Days Present").font.size = Pt(6)
    for idx, m in enumerate(att_months):
        p = att_tbl.cell(2, 1 + idx).paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run(str(m["present"]) if m["present"] else "").font.size = Pt(6)
    p = att_tbl.cell(2, num_att_cols - 1).paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run(str(attendance["total"]["present"]) if attendance["total"]["present"] else "").font.size = Pt(6)

    # Row 3: No. of Days Absent
    att_tbl.cell(3, 0).paragraphs[0].add_run("No. of Days Absent").font.size = Pt(6)
    for idx, m in enumerate(att_months):
        p = att_tbl.cell(3, 1 + idx).paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.add_run(str(m["absent"]) if m["absent"] else "").font.size = Pt(6)
    p = att_tbl.cell(3, num_att_cols - 1).paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run(str(attendance["total"]["absent"]) if attendance["total"]["absent"] else "").font.size = Pt(6)

    # Set borders and padding for attendance table
    for r in att_tbl.rows:
        for c in r.cells:
            _set_cell_border(c, top={"sz": 3}, bottom={"sz": 3}, left={"sz": 3}, right={"sz": 3})
            _set_cell_margins(c, top=15, bottom=15, left=15, right=15)

    # 2. TEACHER'S COMMENTS/REMARKS
    _add_p(right_cell, "TEACHER'S COMMENTS/REMARKS", size=8.5, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_before=4, space_after=2)

    # Term 1 Box
    comm1_tbl = right_cell.add_table(rows=1, cols=1)
    comm1_tbl.autofit = False
    comm1_tbl.columns[0].width = Inches(4.9)
    c1 = comm1_tbl.cell(0, 0)
    _set_cell_border(c1, top={"sz": 4}, bottom={"sz": 4}, left={"sz": 4}, right={"sz": 4})
    _set_cell_margins(c1, top=30, bottom=40, left=50, right=50)
    p = c1.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    p.add_run("Term 1").bold = True
    p.runs[0].font.size = Pt(7.5)
    t1_text = comments.get("term1") or ""
    if t1_text:
        p2 = c1.add_paragraph(t1_text)
        p2.paragraph_format.space_after = Pt(2)
        p2.runs[0].font.size = Pt(7)
    else:
        # Add blank lines for handwriting
        _add_p(c1, "", space_after=12)

    # Term 2 Box
    comm2_tbl = right_cell.add_table(rows=1, cols=1)
    comm2_tbl.autofit = False
    comm2_tbl.columns[0].width = Inches(4.9)
    c2 = comm2_tbl.cell(0, 0)
    _set_cell_border(c2, top={"sz": 4}, bottom={"sz": 4}, left={"sz": 4}, right={"sz": 4})
    _set_cell_margins(c2, top=30, bottom=40, left=50, right=50)
    p = c2.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    p.add_run("Term 2").bold = True
    p.runs[0].font.size = Pt(7.5)
    t2_text = comments.get("term2") or ""
    if t2_text:
        p2 = c2.add_paragraph(t2_text)
        p2.paragraph_format.space_after = Pt(2)
        p2.runs[0].font.size = Pt(7)
    else:
        _add_p(c2, "", space_after=12)

    # Term 3 Box
    comm3_tbl = right_cell.add_table(rows=1, cols=1)
    comm3_tbl.autofit = False
    comm3_tbl.columns[0].width = Inches(4.9)
    c3 = comm3_tbl.cell(0, 0)
    _set_cell_border(c3, top={"sz": 4}, bottom={"sz": 4}, left={"sz": 4}, right={"sz": 4})
    _set_cell_margins(c3, top=30, bottom=40, left=50, right=50)
    p = c3.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    p.add_run("Term 3").bold = True
    p.runs[0].font.size = Pt(7.5)
    t3_text = comments.get("term3") or ""
    if t3_text:
        p2 = c3.add_paragraph(t3_text)
        p2.paragraph_format.space_after = Pt(2)
        p2.runs[0].font.size = Pt(7)
    else:
        _add_p(c3, "", space_after=12)

    # 3. PARENTS/GUARDIAN'S SIGNATURE
    _add_p(right_cell, "PARENTS/GUARDIAN'S SIGNATURE", size=8.5, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_before=4, space_after=2)
    _add_p(right_cell, "Term 1  ___________________________________________________________", size=7.5, space_after=2)
    _add_p(right_cell, "Term 2  ___________________________________________________________", size=7.5, space_after=2)
    _add_p(right_cell, "Term 3  ___________________________________________________________", size=7.5, space_after=4)

    # 4. CERTIFICATE OF TRANSFER
    _add_p(right_cell, "CERTIFICATE OF TRANSFER", size=8.5, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_before=2, space_after=1)
    _add_p(
        right_cell,
        "This is to certify that the above-named learner has satisfactorily completed the requirements for the grade level indicated.",
        size=7,
        space_after=2,
    )
    _add_p(right_cell, f"Admitted to Grade: ________________________________________________", size=7, space_after=1.5)
    _add_p(right_cell, f"Eligible for Admission to Grade: ___________________________________", size=7, space_after=3)

    # Signatures
    _add_p(right_cell, "Approved:", size=7.5, bold=True, space_after=1)
    sig_tbl = right_cell.add_table(rows=2, cols=2)
    sig_tbl.autofit = False
    sig_tbl.columns[0].width = Inches(2.4)
    sig_tbl.columns[1].width = Inches(2.4)

    # Row 0: Names
    p0 = sig_tbl.cell(0, 0).paragraphs[0]
    p0.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p0.add_run(school.get("principal_name") or "School Head").bold = True
    p0.runs[0].font.size = Pt(7.5)

    p1 = sig_tbl.cell(0, 1).paragraphs[0]
    p1.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p1.add_run(class_info.get("adviser_name") or "Adviser").bold = True
    p1.runs[0].font.size = Pt(7.5)

    # Row 1: Titles
    p_t0 = sig_tbl.cell(1, 0).paragraphs[0]
    p_t0.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_t0.add_run("_____________________________\nSchool Head").font.size = Pt(7)

    p_t1 = sig_tbl.cell(1, 1).paragraphs[0]
    p_t1.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_t1.add_run("_____________________________\nAdviser").font.size = Pt(7)

    # 5. CANCELLATION OF ELIGIBILITY TO TRANSFER
    _add_p(right_cell, "CANCELLATION OF ELIGIBILITY TO TRANSFER", size=8, bold=True, align=WD_ALIGN_PARAGRAPH.CENTER, space_before=4, space_after=1)
    _add_p(right_cell, "Admitted in: _________________________________     Date: _________________", size=7, space_after=2)
    _add_p(right_cell, "_____________________________\nSchool Head", size=7, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=0)


def export_student_sf9_docx(
    db: Session,
    class_id: int,
    student_id: str,
    staff_id: str,
    comments: dict[str, str] | None = None,
) -> io.BytesIO:
    """Generate Word (.docx) SF9 report card for an individual student."""
    data = gather_student_sf9_data(db, class_id, student_id, staff_id)

    doc = docx.Document()
    section = doc.sections[0]
    section.orientation = WD_ORIENT.LANDSCAPE
    section.page_width = Inches(11.0)
    section.page_height = Inches(8.5)
    section.top_margin = Inches(0.35)
    section.bottom_margin = Inches(0.35)
    section.left_margin = Inches(0.35)
    section.right_margin = Inches(0.35)

    render_student_sf9_docx(doc, data, comments)

    output = io.BytesIO()
    doc.save(output)
    output.seek(0)
    return output


def export_advisory_class_sf9_batch_docx(
    db: Session,
    class_id: int,
    staff_id: str,
) -> io.BytesIO:
    """Generate multi-student Word (.docx) workbook with a 2-column landscape page per student."""
    batch_data = gather_advisory_class_sf9_batch_data(db, class_id, staff_id)

    doc = docx.Document()
    section = doc.sections[0]
    section.orientation = WD_ORIENT.LANDSCAPE
    section.page_width = Inches(11.0)
    section.page_height = Inches(8.5)
    section.top_margin = Inches(0.35)
    section.bottom_margin = Inches(0.35)
    section.left_margin = Inches(0.35)
    section.right_margin = Inches(0.35)

    for idx, student_data in enumerate(batch_data):
        if idx > 0:
            doc.add_page_break()
        render_student_sf9_docx(doc, student_data)

    output = io.BytesIO()
    doc.save(output)
    output.seek(0)
    return output
