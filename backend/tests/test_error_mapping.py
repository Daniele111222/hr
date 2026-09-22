from sqlalchemy.exc import IntegrityError

from paylite.api.errors import integrity_detail


def make_error(message: str) -> IntegrityError:
    return IntegrityError("insert", {}, Exception(message))


def test_integrity_error_mapping_explains_business_identifiers() -> None:
    assert integrity_detail(make_error("uq_city_code")) == "城市编码已存在"
    assert (
        integrity_detail(make_error("uq_employee_company_id_number")) == "身份证号码已在本公司使用"
    )
    assert integrity_detail(make_error("uq_employee_bank_account")) == "该银行卡已登记"


def test_integrity_error_mapping_explains_ranges_and_foreign_keys() -> None:
    assert (
        integrity_detail(make_error("daterange exclusion violation"))
        == "生效日期区间与已有记录重叠"
    )
    assert (
        integrity_detail(make_error("violates foreign key constraint"))
        == "关联数据不存在或仍被其他数据引用"
    )
    assert integrity_detail(make_error("ck_department_not_self_parent")) == "上级部门不能是自身"
    assert (
        integrity_detail(make_error("Department hierarchy cannot contain a cycle"))
        == "部门上下级不能形成循环"
    )
