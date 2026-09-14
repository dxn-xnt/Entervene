"""Domain exceptions for AI Model Registry and Scoring Services."""
from __future__ import annotations


class ModelRegistryError(Exception):
    """Base exception for model registry errors."""


class UnsupportedModelPurpose(ModelRegistryError, ValueError):
    """Raised when an unknown or unsupported model purpose is requested."""


class ActiveModelNotFound(ModelRegistryError, LookupError):
    """Raised when no active model version is found for a purpose or name."""


class ModelPurposeMismatch(ModelRegistryError, ValueError):
    """Raised when an artifact or report purpose does not match the expected purpose."""


class ArtifactIntegrityError(ModelRegistryError, ValueError):
    """Raised when artifact files, schemas, or manifests fail integrity/digest checks."""


class ConcurrentActivationConflict(ModelRegistryError, RuntimeError):
    """Raised when concurrent activations conflict on the active model purpose uniqueness constraint."""
