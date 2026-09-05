"""Add per-user agent memory: preferences (exact) + memory snippets (RAG mirror)

Revision ID: 0023
Revises: 0022
"""

from alembic import op
import sqlalchemy as sa


revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        "user_preferences",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("pref_key", sa.Text(), nullable=False),
        sa.Column("pref_value", sa.Text(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True),server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "pref_key", name="uq_user_preferences_user_id_pref_key"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )

    op.create_table(
        "agent_memory_snippets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("snippet", sa.Text(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True),server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="SET NULL"),
    )
    op.create_index("idx_agent_memory_snippets_user_id", "agent_memory_snippets", ["user_id"])


def downgrade() -> None:
    op.drop_index("idx_agent_memory_snippets_user_id", "agent_memory_snippets")
    op.drop_table("agent_memory_snippets")
    op.drop_table("user_preferences")