from rest_framework.permissions import BasePermission


class IsSuperadmin(BasePermission):
    """Global scope. Only platform superadmins may pass."""

    message = 'Superadmin access required.'

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == 'superadmin'
        )


class IsEducator(BasePermission):
    """Only educators may pass."""

    message = 'Educator access required.'

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == 'educator'
        )


class IsStudent(BasePermission):
    """Only students may pass."""

    message = 'Student access required.'

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == 'student'
        )
