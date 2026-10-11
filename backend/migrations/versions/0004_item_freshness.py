"""items.freshness: fresh | semi_fresh | spoiled from the vision model (nullable = unknown)

Revision ID: 0004_item_freshness
Revises: 0003_food_group
"""
import sqlalchemy as sa
from alembic import op

revision = "0004_item_freshness"
down_revision = "0003_food_group"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("items", sa.Column("freshness", sa.Text, nullable=True))
    op.create_check_constraint(
        "ck_items_freshness", "items", "freshness IS NULL OR freshness IN ('fresh','semi_fresh','spoiled')")


def downgrade():
    op.drop_constraint("ck_items_freshness", "items", type_="check")
    op.drop_column("items", "freshness")
