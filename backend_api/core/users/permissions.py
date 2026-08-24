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


class IsSchoolAdmin(BasePermission):
    """Tenant-level scope. Requires role == 'admin' AND a school assignment."""

    message = 'School admin access required.'

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role == 'admin'
            and request.user.school_id is not None
        )


class IsSameSchool(BasePermission):
    """Object-level: superadmin bypasses; admin may only touch same-school rows."""

    message = 'You are not authorized to access this resource.'

    def has_object_permission(self, request, view, obj):
        if request.user.role == 'superadmin':
            return True
        if request.user.role != 'admin':
            return False
        school_id = getattr(obj, 'school_id', None)
        return school_id is not None and school_id == request.user.school_id
