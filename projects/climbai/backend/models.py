from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class InputModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ProfileInput(InputModel):
    nickname: str = Field(default="攀岩新朋友", min_length=1, max_length=40)
    experience_months: int = Field(default=3, ge=0, le=120)
    grade: str = Field(default="暂不清楚", max_length=30)
    grade_system: str = Field(default="V", max_length=30)
    gym: str = Field(default="室内抱石馆", max_length=80)
    sessions_per_week: int = Field(default=2, ge=1, le=3)
    available_minutes: int = Field(default=60, ge=20, le=120)
    equipment: list[Literal["climbing_wall", "mat"]] = Field(default_factory=lambda: ["climbing_wall", "mat"])
    goal: str = Field(default="建立规律训练与复盘习惯", min_length=2, max_length=240)
    focus: Literal["footwork", "route_reading", "consistency", "body_position"] = "footwork"
    recent_pain: bool = False
    adult_confirmed: bool = False
    correction: str = Field(default="", max_length=500)

    @field_validator("equipment")
    @classmethod
    def equipment_unique(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))


class GenerateInput(InputModel):
    goal: str | None = Field(default=None, min_length=2, max_length=240)
    available_minutes: int | None = Field(default=None, ge=20, le=120)


class VersionInput(InputModel):
    expected_version: int = Field(ge=1)


class CompleteInput(InputModel):
    actual_minutes: int = Field(ge=0, le=240)


class FeedbackInput(InputModel):
    difficulty: int = Field(ge=1, le=5)
    completed: bool = True
    main_issue: str = Field(default="没有明显卡点", max_length=120)
    pain: bool = False
    notes: str = Field(default="", max_length=1500)
    actual_minutes: int | None = Field(default=None, ge=0, le=240)


class QuestionInput(InputModel):
    question: str = Field(min_length=2, max_length=1200)


class ResetInput(InputModel):
    scenario: Literal["footwork", "time_short", "pain", "empty"] = "footwork"
