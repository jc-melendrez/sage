from django.contrib.auth import get_user_model
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken


class SAGETokenObtainPairSerializer(TokenObtainPairSerializer):
    """Adds role / token_version claims to the access token."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token['role'] = user.role
        token['token_version'] = user.token_version
        return token


class SAGERefreshToken(RefreshToken):
    """RefreshToken subclass that carries role / token_version claims.

    Must be used everywhere a token pair is issued programmatically
    (firebase-login, OTP verify) — TokenVersionAuthentication rejects
    access tokens whose token_version claim is stale or missing.
    """

    @classmethod
    def for_user(cls, user):
        token = super().for_user(user)
        token['role'] = user.role
        token['token_version'] = user.token_version
        return token


class SAGETokenRefreshSerializer(TokenRefreshSerializer):
    """Turns a refresh token for a user who no longer exists into a 401.

    simplejwt's TokenRefreshSerializer looks the user up with an unguarded
    `get_user_model().objects.get(...)`, and TokenViewBase only catches
    TokenError, so a token minted before the account was deleted (or before a
    database rebuild dropped the row) raises DoesNotExist and leaves as a 500.

    A 500 is the worst possible answer here. The mobile client classifies any
    5xx as transient -- "the backend is still waking up" -- keeps the dead
    token and retries, so the user is neither logged in nor logged out and every
    authenticated call fails the same way. InvalidToken is a 401, which the
    client already treats as expired and answers by signing out.
    """

    def validate(self, attrs):
        try:
            return super().validate(attrs)
        except get_user_model().DoesNotExist:
            raise InvalidToken('This account no longer exists. Please log in again.')


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
