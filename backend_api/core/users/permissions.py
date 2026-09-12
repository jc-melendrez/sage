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
