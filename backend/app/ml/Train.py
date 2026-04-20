import joblib
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score
from imblearn.over_sampling import SMOTE

from app.services.DataLoader import load_oulad
from app.ml.FeatureEngineering import build_features, select_features

MODEL_PATH = Path(__file__).parent / "model.pkl"
FEATURES_PATH = Path(__file__).parent / "feature_columns.pkl"

def train():
    print("Loading OULAD data...")
    student_info, student_assess, assessments, student_vle, student_reg = load_oulad()

    print("Building features...")
    df = build_features(student_info, student_assess, assessments, student_vle, student_reg)
    X, y = select_features(df)

    joblib.dump(list(X.columns), FEATURES_PATH)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    print("Applying SMOTE...")
    sm = SMOTE(random_state=42)
    X_train_res, y_train_res = sm.fit_resample(X_train, y_train)

    print("Training Random Forest...")
    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=None,
        min_samples_split=5,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train_res, y_train_res)

    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    print("\n=== Evaluation ===")
    print(classification_report(y_test, y_pred, target_names=["Not At Risk", "At Risk"]))
    print(f"ROC-AUC: {roc_auc_score(y_test, y_prob):.4f}")

    joblib.dump(model, MODEL_PATH)
    print(f"\nModel saved to {MODEL_PATH}")

if __name__ == "__main__":
    train()