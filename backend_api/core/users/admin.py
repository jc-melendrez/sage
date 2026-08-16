from django.contrib import admin
from .models import User, Badge, Recommendation, Session, Activity, School, RoleChangeLog

admin.site.register(User)
admin.site.register(Badge)
admin.site.register(Recommendation)
admin.site.register(Session)
admin.site.register(Activity)
admin.site.register(School)
admin.site.register(RoleChangeLog)
