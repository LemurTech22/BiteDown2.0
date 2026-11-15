"""Per-item photos and temporary, owner-scoped photo claims.

Revision ID: 0009_item_photos
Revises: 0008_share_pickup
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0009_item_photos"
down_revision = "0008_share_pickup"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("items", sa.Column("photo_key", sa.String(32), nullable=True))
    op.create_table(
        "staged_photos",
        sa.Column("token", sa.String(32), primary_key=True),
        sa.Column("owner_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("photo_key", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table("staged_photos")
    op.drop_column("items", "photo_key")
