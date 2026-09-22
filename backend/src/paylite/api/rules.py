from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from paylite.api.deps import get_db
from paylite.api.schemas import AttendanceRuleIn, AttendanceRuleOut, CityRuleIn, CityRuleOut
from paylite.db.models import (
    AttendanceRule,
    City,
    HousingFundRule,
    SocialSecurityItemRule,
    SocialSecurityRule,
)

router = APIRouter(prefix="/rules", tags=["rules"])


def _city_rule_out(rule: SocialSecurityRule, db: Session) -> CityRuleOut:
    city = db.get(City, rule.city_id)
    housing = db.scalar(
        select(HousingFundRule).where(
            HousingFundRule.city_id == rule.city_id,
            HousingFundRule.effective_from == rule.effective_from,
        )
    )
    items = list(
        db.scalars(
            select(SocialSecurityItemRule)
            .where(SocialSecurityItemRule.social_security_rule_id == rule.id)
            .order_by(SocialSecurityItemRule.item_code)
        )
    )
    return CityRuleOut(
        id=rule.id,
        city_id=rule.city_id,
        city_name=city.name if city else "未知城市",
        effective_from=rule.effective_from,
        effective_to=rule.effective_to,
        version=rule.version,
        source=rule.source,
        fixed_base=rule.fixed_base,
        social_items=items,
        housing_company_rate=housing.company_rate if housing else None,
        housing_employee_rate=housing.employee_rate if housing else None,
        housing_base_source=housing.base_source if housing else None,
    )


@router.get("/city-rules", response_model=list[CityRuleOut])
def list_city_rules(db: Session = Depends(get_db)):
    rules = db.scalars(
        select(SocialSecurityRule).order_by(
            SocialSecurityRule.city_id, SocialSecurityRule.effective_from.desc()
        )
    )
    return [_city_rule_out(rule, db) for rule in rules]


@router.post("/city-rules", response_model=CityRuleOut, status_code=status.HTTP_201_CREATED)
def create_city_rule(payload: CityRuleIn, db: Session = Depends(get_db)):
    if not db.get(City, payload.city_id):
        raise HTTPException(404, "城市不存在")
    rule = SocialSecurityRule(
        city_id=payload.city_id,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
        version=payload.version,
        source=payload.source,
        fixed_base=payload.fixed_base,
    )
    db.add(rule)
    db.flush()
    db.add_all(
        [
            SocialSecurityItemRule(
                social_security_rule_id=rule.id,
                item_code=item.item_code,
                item_name=item.item_name,
                company_rate=item.company_rate,
                employee_rate=item.employee_rate,
                base_min=0,
                base_max=0,
            )
            for item in payload.social_items
        ]
    )
    db.add(
        HousingFundRule(
            city_id=payload.city_id,
            effective_from=payload.effective_from,
            effective_to=payload.effective_to,
            company_rate=payload.housing_company_rate,
            employee_rate=payload.housing_employee_rate,
            base_min=0,
            base_max=0,
            version=payload.version,
            source=payload.source,
            base_source="fixed_salary",
        )
    )
    db.commit()
    db.refresh(rule)
    return _city_rule_out(rule, db)


@router.get("/attendance", response_model=list[AttendanceRuleOut])
def list_attendance_rules(db: Session = Depends(get_db)):
    return list(db.scalars(select(AttendanceRule).order_by(AttendanceRule.effective_from.desc())))


@router.post("/attendance", response_model=AttendanceRuleOut, status_code=status.HTTP_201_CREATED)
def create_attendance_rule(payload: AttendanceRuleIn, db: Session = Depends(get_db)):
    rule = AttendanceRule(**payload.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule
