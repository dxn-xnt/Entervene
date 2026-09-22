class ActiveModelNotFound(LookupError):
    pass


class ArtifactIntegrityError(ValueError):
    pass


class ConcurrentActivationConflict(RuntimeError):
    pass


class ModelPurposeMismatch(ValueError):
    pass


class UnsupportedModelPurpose(ValueError):
    pass
