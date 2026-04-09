from typing import Optional, Union, List, Dict, Any
from fastapi import HTTPException, Request, status
from open_webui.models.users import Users, UserModel
from open_webui.models.groups import Groups


from open_webui.config import DEFAULT_USER_PERMISSIONS
from open_webui.constants import ERROR_MESSAGES
import json


def fill_missing_permissions(
    permissions: Dict[str, Any], default_permissions: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Recursively fills in missing properties in the permissions dictionary
    using the default permissions as a template.
    """
    for key, value in default_permissions.items():
        if key not in permissions:
            permissions[key] = value
        elif isinstance(value, dict) and isinstance(
            permissions[key], dict
        ):  # Both are nested dictionaries
            permissions[key] = fill_missing_permissions(permissions[key], value)

    return permissions


def get_permissions(
    user_id: str,
    default_permissions: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Get all permissions for a user by combining the permissions of all groups the user is a member of.
    If a permission is defined in multiple groups, the most permissive value is used (True > False).
    Permissions are nested in a dict with the permission key as the key and a boolean as the value.
    """

    def combine_permissions(
        permissions: Dict[str, Any], group_permissions: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Combine permissions from multiple groups by taking the most permissive value."""
        for key, value in group_permissions.items():
            if isinstance(value, dict):
                if key not in permissions:
                    permissions[key] = {}
                permissions[key] = combine_permissions(permissions[key], value)
            else:
                if key not in permissions:
                    permissions[key] = value
                else:
                    permissions[key] = (
                        permissions[key] or value
                    )  # Use the most permissive value (True > False)
        return permissions

    user_groups = Groups.get_groups_by_member_id(user_id)

    # Deep copy default permissions to avoid modifying the original dict
    permissions = json.loads(json.dumps(default_permissions))

    # Combine permissions from all user groups
    for group in user_groups:
        group_permissions = group.permissions
        permissions = combine_permissions(permissions, group_permissions)

    # Ensure all fields from default_permissions are present and filled in
    permissions = fill_missing_permissions(permissions, default_permissions)

    return permissions


def has_permission(
    user_id: str,
    permission_key: str,
    default_permissions: Dict[str, Any] = {},
) -> bool:
    """
    Check if a user has a specific permission by checking the group permissions
    and fall back to default permissions if not found in any group.

    Permission keys can be hierarchical and separated by dots ('.').
    """

    def get_permission(permissions: Dict[str, Any], keys: List[str]) -> bool:
        """Traverse permissions dict using a list of keys (from dot-split permission_key)."""
        for key in keys:
            if key not in permissions:
                return False  # If any part of the hierarchy is missing, deny access
            permissions = permissions[key]  # Traverse one level deeper

        return bool(permissions)  # Return the boolean at the final level

    permission_hierarchy = permission_key.split(".")

    # Retrieve user group permissions
    user_groups = Groups.get_groups_by_member_id(user_id)

    for group in user_groups:
        group_permissions = group.permissions
        if get_permission(group_permissions, permission_hierarchy):
            return True

    # Check default permissions afterward if the group permissions don't allow it
    default_permissions = fill_missing_permissions(
        default_permissions, DEFAULT_USER_PERMISSIONS
    )
    return get_permission(default_permissions, permission_hierarchy)


def has_access(
    user_id: str,
    type: str = "write",
    access_control: Optional[dict] = None,
) -> bool:
    if access_control is None:
        return type == "read"

    user_groups = Groups.get_groups_by_member_id(user_id)
    user_group_ids = [group.id for group in user_groups]
    permission_access = access_control.get(type, {})
    permitted_group_ids = permission_access.get("group_ids", [])
    permitted_user_ids = permission_access.get("user_ids", [])

    if "*" in permitted_user_ids:
        return True

    return user_id in permitted_user_ids or any(
        group_id in permitted_group_ids for group_id in user_group_ids
    )


def _get_user_id(user: Union[str, Any]) -> str:
    if isinstance(user, str):
        return user
    return str(getattr(user, "id", "") or "")


def _get_user_role(user: Any) -> str:
    return str(getattr(user, "role", "") or "")


def is_admin_user(user: Any) -> bool:
    return _get_user_role(user) == "admin"


def is_resource_owner(user: Any, resource: Any) -> bool:
    return _get_user_id(user) == str(getattr(resource, "user_id", "") or "")


def normalize_access_control(access_control: Optional[dict]) -> Optional[dict]:
    if access_control is None:
        return None

    access_control = access_control if isinstance(access_control, dict) else {}

    def _normalize_ids(values: Any) -> list[str]:
        if not isinstance(values, list):
            return []
        normalized = []
        seen = set()
        for value in values:
            if value is None:
                continue
            item = str(value)
            if item in seen:
                continue
            seen.add(item)
            normalized.append(item)
        return sorted(normalized)

    normalized = {}
    for permission in ("read", "write"):
        permission_access = access_control.get(permission, {})
        permission_access = (
            permission_access if isinstance(permission_access, dict) else {}
        )
        normalized[permission] = {
            "group_ids": _normalize_ids(permission_access.get("group_ids", [])),
            "user_ids": _normalize_ids(permission_access.get("user_ids", [])),
        }

    return normalized


def access_control_changed(
    current_access_control: Optional[dict], next_access_control: Optional[dict]
) -> bool:
    return normalize_access_control(current_access_control) != normalize_access_control(
        next_access_control
    )


def can_read_resource(user: Any, resource: Any) -> bool:
    if resource is None:
        return False
    if is_admin_user(user) or is_resource_owner(user, resource):
        return True
    return has_access(
        _get_user_id(user),
        "read",
        getattr(resource, "access_control", None),
    )


def can_write_resource(user: Any, resource: Any) -> bool:
    if resource is None:
        return False
    if is_admin_user(user) or is_resource_owner(user, resource):
        return True
    return has_access(
        _get_user_id(user),
        "write",
        getattr(resource, "access_control", None),
    )


def can_manage_resource_acl(user: Any, resource: Any) -> bool:
    if resource is None:
        return False
    return is_admin_user(user) or is_resource_owner(user, resource)


def ensure_requested_access_control_allowed(
    request: Request,
    user: Any,
    requested_access_control: Optional[dict],
    public_permission_key: Optional[str] = None,
) -> None:
    if requested_access_control is not None or is_admin_user(user):
        return

    if public_permission_key and has_permission(
        _get_user_id(user),
        public_permission_key,
        request.app.state.config.USER_PERMISSIONS,
    ):
        return

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=ERROR_MESSAGES.ACCESS_PROHIBITED,
    )


def ensure_resource_acl_change_allowed(
    request: Request,
    user: Any,
    resource: Any,
    requested_access_control: Optional[dict],
    public_permission_key: Optional[str] = None,
) -> None:
    if not access_control_changed(
        getattr(resource, "access_control", None), requested_access_control
    ):
        return

    if not can_manage_resource_acl(user, resource):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ERROR_MESSAGES.ACCESS_PROHIBITED,
        )

    ensure_requested_access_control_allowed(
        request,
        user,
        requested_access_control,
        public_permission_key=public_permission_key,
    )


# Get all users with access to a resource
def get_users_with_access(
    type: str = "write", access_control: Optional[dict] = None
) -> List[UserModel]:
    if access_control is None:
        return Users.get_users()

    permission_access = access_control.get(type, {})
    permitted_group_ids = permission_access.get("group_ids", [])
    permitted_user_ids = permission_access.get("user_ids", [])

    if "*" in permitted_user_ids:
        return Users.get_users()

    user_ids_with_access = set(permitted_user_ids)

    for group_id in permitted_group_ids:
        group_user_ids = Groups.get_group_user_ids_by_id(group_id)
        if group_user_ids:
            user_ids_with_access.update(group_user_ids)

    return Users.get_users_by_user_ids(list(user_ids_with_access))
