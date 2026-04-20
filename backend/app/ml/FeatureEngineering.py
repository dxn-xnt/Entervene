import pandas as pd

def build_features(student_info, student_assess, assessments, student_vle, student_reg):

    student_info = student_info.copy()
    student_info["at_risk"] = student_info["final_result"].isin(["Fail", "Withdrawn"]).astype(int)

    vle_agg = student_vle.groupby("id_student").agg(
        total_clicks=("sum_click", "sum"),
        active_days=("date", "nunique"),
        avg_daily_clicks=("sum_click", "mean"),
    ).reset_index()

    assess_meta = student_assess.merge(assessments[["id_assessment", "date"]], on="id_assessment", how="left")
    assess_meta["submission_delay"] = assess_meta["date_submitted"] - assess_meta["date"]

    assess_agg = assess_meta.groupby("id_student").agg(
        avg_score=("score", "mean"),
        min_score=("score", "min"),
        avg_submission_delay=("submission_delay", "mean"),
        num_assessments_submitted=("id_assessment", "count"),
    ).reset_index()

    student_reg["early_withdrawal"] = student_reg["date_unregistration"].notna().astype(int)
    reg_features = student_reg[["id_student", "date_registration", "early_withdrawal"]]

    df = student_info.merge(vle_agg, on="id_student", how="left")
    df = df.merge(assess_agg, on="id_student", how="left")
    df = df.merge(reg_features, on="id_student", how="left")

    return df


def select_features(df):
    categorical = ["gender", "age_band", "imd_band", "highest_education", "disability"]
    numeric = [
        "num_of_prev_attempts",
        "studied_credits",
        "total_clicks",
        "active_days",
        "avg_daily_clicks",
        "avg_score",
        "min_score",
        "avg_submission_delay",
        "num_assessments_submitted",
        "early_withdrawal",
    ]

    df_encoded = pd.get_dummies(df[categorical + numeric + ["at_risk"]], columns=categorical)
    df_encoded.fillna(df_encoded.median(numeric_only=True), inplace=True)

    X = df_encoded.drop("at_risk", axis=1)
    y = df_encoded["at_risk"]

    return X, y