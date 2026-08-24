from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken


class SAGETokenObtainPairSerializer(TokenObtainPairSerializer):
    """Adds role / school / token_version claims to the access token."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token['role'] = user.role
        token['school_id'] = user.school_id
        token['token_version'] = user.token_version
        return token


class TokenVersionAuthentication(JWTAuthentication):
    """Rejects tokens whose `token_version` claim is stale (role changed, deactivated, etc.)."""

    def authenticate(self, request):
        user_tuple = super().authenticate(request)
        if user_tuple is None:
            return None
        user, validated_token = user_tuple
        if user is None:
            return None
        claimed = validated_token.get('token_version', 0)
        if claimed != user.token_version:
            raise InvalidToken('Token has been revoked. Please log in again.')
        return user, validated_token
