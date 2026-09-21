/* 轻算薪 — 共享数据引擎、外壳渲染与交互
   全站唯一的演示数据来源：三个主体、128 名员工、2026-08 工资期间。
   所有页面的人数与金额都由这里计算，保证跨页一致。 */

(function () {
  'use strict';

  /* ══ 1. 确定性随机（保证每次刷新数据一致） ═══════════════════ */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedOf(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /* ══ 2. 基础资料 ═════════════════════════════════════════════ */
  var COMPANY = {
    name: '星澜科技（演示）有限公司',
    code: '91310115MA1K3XYZ8T',
    hr: '人事行政中心',
    period: '2026-08'
  };

  var ENTITIES = [
    { code: 'SH01', name: '星澜科技（上海）有限公司', short: '上海', city: '上海', headcount: 96 },
    { code: 'BJ01', name: '星澜科技（北京）有限公司', short: '北京', city: '北京', headcount: 24 },
    { code: 'SZ01', name: '星澜科技（深圳）有限公司', short: '深圳', city: '深圳', headcount: 8 }
  ];

  /* 共用部门树：同一套部门体系在各主体下形成实例 */
  var DEPTS = [
    { code: 'D0100', name: '研发中心', parent: '' },
    { code: 'D0101', name: '平台研发部', parent: 'D0100' },
    { code: 'D0102', name: '应用研发部', parent: 'D0100' },
    { code: 'D0103', name: '测试与质量部', parent: 'D0100' },
    { code: 'D0200', name: '产品设计部', parent: '' },
    { code: 'D0201', name: '产品部', parent: 'D0200' },
    { code: 'D0202', name: '设计部', parent: 'D0200' },
    { code: 'D0300', name: '市场部', parent: '' },
    { code: 'D0400', name: '销售部', parent: '' },
    { code: 'D0500', name: '财务部', parent: '' },
    { code: 'D0600', name: '人力资源部', parent: '' },
    { code: 'D0700', name: '行政部', parent: '' }
  ];

  /* 各主体下启用的部门 */
  var ENTITY_DEPTS = {
    SH01: ['D0101', 'D0102', 'D0103', 'D0201', 'D0202', 'D0300', 'D0500', 'D0600'],
    BJ01: ['D0102', 'D0400'],
    SZ01: ['D0101']
  };

  var GRADES = [
    { code: 'P4', name: 'P4 初级', salary: 9000 },
    { code: 'P5', name: 'P5 中级', salary: 14000 },
    { code: 'P6', name: 'P6 高级', salary: 20000 },
    { code: 'P7', name: 'P7 专家', salary: 28000 },
    { code: 'P8', name: 'P8 资深专家', salary: 38000 }
  ];
  var GRADE_SALARY = { P4: 9000, P5: 14000, P6: 20000, P7: 28000, P8: 38000 };
  var GRADE_NAME = { P4: 'P4 初级', P5: 'P5 中级', P6: 'P6 高级', P7: 'P7 专家', P8: 'P8 资深专家' };

  /* 城市社保与公积金规则（演示配置，真实数值待维护） */
  var CITY_RULES = {
    '上海': {
      base: 7384, validFrom: '2026-01-01', validTo: '2026-12-31', status: 'valid', version: 'v2026.1',
      personal: [{ k: '养老', r: 0.08 }, { k: '医疗', r: 0.02 }, { k: '失业', r: 0.005 }],
      company: [{ k: '养老', r: 0.16 }, { k: '医疗', r: 0.095 }, { k: '失业', r: 0.005 }, { k: '工伤', r: 0.0016 }, { k: '生育', r: 0.01 }]
    },
    '北京': {
      base: 6821, validFrom: '2026-01-01', validTo: '2026-12-31', status: 'valid', version: 'v2026.1',
      personal: [{ k: '养老', r: 0.08 }, { k: '医疗', r: 0.02 }, { k: '失业', r: 0.005 }],
      company: [{ k: '养老', r: 0.16 }, { k: '医疗', r: 0.09 }, { k: '失业', r: 0.005 }, { k: '工伤', r: 0.004 }, { k: '生育', r: 0.008 }]
    },
    '深圳': {
      base: 4492, validFrom: '2025-01-01', validTo: '2026-07-31', status: 'expired', version: 'v2025.1',
      personal: [{ k: '养老', r: 0.08 }, { k: '医疗', r: 0.02 }, { k: '失业', r: 0.003 }],
      company: [{ k: '养老', r: 0.15 }, { k: '医疗', r: 0.052 }, { k: '失业', r: 0.007 }, { k: '工伤', r: 0.0014 }, { k: '生育', r: 0.0045 }]
    }
  };
  var HF_RATE = 0.05;          /* 公积金单边比例：固定薪资 × 5% */
  var STD_DAYS = 21;           /* 应出勤天数，来自考勤表 */
  var STD_HOURS = 8;           /* 每日标准工时 */

  /* 深圳规则补齐后新增的 2026 版本（演示配置）。旧版本仍然保留，
     2026-07 等已锁定期间继续命中旧版本，历史金额不变。 */
  var SZ_RULE_2026 = {
    base: 4772, validFrom: '2026-08-01', validTo: '2026-12-31', status: 'valid', version: 'v2026.2',
    personal: [{ k: '养老', r: 0.08 }, { k: '医疗', r: 0.02 }, { k: '失业', r: 0.003 }],
    company: [{ k: '养老', r: 0.15 }, { k: '医疗', r: 0.052 }, { k: '失业', r: 0.007 }, { k: '工伤', r: 0.0014 }, { k: '生育', r: 0.0045 }]
  };
  /* 一个城市的全部规则版本（含历史版本） */
  function ruleVersions(city) {
    var out = [];
    if (CITY_RULES[city]) out.push(CITY_RULES[city]);
    if (city === '深圳' && state().szRuleAdded) out.push(SZ_RULE_2026);
    return out;
  }

  /* 工资期间 */
  var PERIODS = [
    { code: '2026-08', label: '2026 年 8 月', status: 'open' },
    { code: '2026-07', label: '2026 年 7 月', status: 'locked' },
    { code: '2026-06', label: '2026 年 6 月', status: 'locked' }
  ];

  /* ══ 3. 员工名册（由确定性算法生成，全站共用） ═══════════════ */
  var SURNAME = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾田董袁潘于蒋蔡余杜叶程苏魏吕丁沈任姚卢傅钟姜崔谭廖范汪陆金石戴贾韦夏邱方侯邹熊孟秦白江阎薛尹段雷黎史陶毛郝顾龚邵万钱严赖覃洪武莫孔汤向常温康施文牛樊葛邢安齐易乔伍庞颜倪庄聂章鲁岳翟殷詹申欧耿关兰焦俞左柳甘祝包宁尚符舒阮柯纪梅童凌毕单季裴霍涂成苗谷盛曲翁冉骆蓝路游辛靳管柴蒙鲍华喻祁蒲房滕屈饶解牟艾尤阳时穆农司卓古吉缪简车项连芦麦褚娄窦戚岑景党宫费卜冷晏席卫米柏宗瞿桂全佟应臧闵苟邬边卞姬邴'
    .split('');
  var GIVEN = ('安琪|博文|思远|梓涵|宇轩|梦琪|靖宇|астра|静怡|泽楷|嘉禾|书瑶|子墨|亦辰|婉清|皓然|若彤|астра|文柏|晓棠|致远|心怡|越泽|颖萱|承远|慧敏|天佑|可欣|浩然|雨桐|锦程|悦宁|弘毅|语彤|睿泽|思彤|慕白|清和|怀瑾|昭然|以宁|知远|念安|沐辰|夕瑶|展鹏|逸帆|砚书|望舒|寒松|舒窈|南乔|宜修|астра|和风|白露|青禾|朝雨|樾川|秋霁|归舟|既明|照野|拾光|астра|向晚|临安|流萤|折枝|叩月|衔青|苏晚|落白|明川|醒时|砚青|松雪|长安|云舒|栖迟|岸风|听澜|映初|扶苏|衡之|言之|慎之|怀之|问之|亦然|未然|悠然|斐然|焕然|岸然')
      .split('|').filter(function (s) { return /^[\u4e00-\u9fa5]{2,3}$/.test(s); });

  function buildEmployees() {
    var rnd = mulberry32(seedOf('xinglan-hr-2026'));
    var out = [];
    var used = {};
    var titles = {
      D0101: ['后端开发工程师', '高级后端开发工程师', '服务端开发工程师', '技术专家'],
      D0102: ['前端开发工程师', '客户端开发工程师', '全栈开发工程师'],
      D0103: ['测试开发工程师', '质量保障工程师'],
      D0201: ['产品经理', '高级产品经理'],
      D0202: ['交互设计师', '视觉设计师'],
      D0300: ['市场专员', '市场经理', '品牌运营'],
      D0400: ['销售代表', '客户经理', '销售总监'],
      D0500: ['会计', '财务专员', '财务经理'],
      D0600: ['招聘专员', '薪酬绩效专员', 'HRBP'],
      D0700: ['行政专员', '行政主管']
    };
    var idx = 0;
    ENTITIES.forEach(function (ent) {
      var depts = ENTITY_DEPTS[ent.code];
      for (var i = 0; i < ent.headcount; i++) {
        idx++;
        var name;
        do {
          name = SURNAME[Math.floor(rnd() * SURNAME.length)] + GIVEN[Math.floor(rnd() * GIVEN.length)];
        } while (used[name]);
        used[name] = 1;

        var dept = depts[Math.floor(rnd() * depts.length)];
        var pool = titles[dept] || titles.D0101;
        var title = pool[Math.floor(rnd() * pool.length)];
        var gRoll = rnd(), grade;
        if (gRoll < 0.20) grade = 'P4';
        else if (gRoll < 0.55) grade = 'P5';
        else if (gRoll < 0.82) grade = 'P6';
        else if (gRoll < 0.94) grade = 'P7';
        else grade = 'P8';

        /* 4 名本期离职、2 名本期入职 */
        var leaveDate = null, hireDate, regularDate, state = '在职';
        var hy = 2019 + Math.floor(rnd() * 6);
        var hm = 1 + Math.floor(rnd() * 11);
        var hd = 1 + Math.floor(rnd() * 27);
        hireDate = hy + '-' + pad2(hm) + '-' + pad2(hd);
        regularDate = addMonths(hireDate, 3);

        var probation = false;
        if (idx === 14 || idx === 51 || idx === 77 || idx === 96) {
          leaveDate = '2026-08-15'; state = '离职';
        } else if (idx === 33 || idx === 108) {
          hireDate = '2026-08-11'; regularDate = '2026-11-11'; probation = true;
        } else if (idx % 23 === 0) {
          /* 近期入职仍在试用期 */
          hireDate = '2026-06-09'; regularDate = '2026-09-09'; probation = true;
        } else if (idx % 37 === 0) {
          /* 本月转正 */
          hireDate = '2026-03-16'; regularDate = '2026-08-01'; probation = false;
        }

        var personalCity = rnd() < 0.08 ? ['北京', '上海', '深圳'][Math.floor(rnd() * 3)] : ent.city;

        out.push({
          id: 'EMP' + String(1000 + idx).slice(1),
          seq: idx,
          name: name,
          idcard: genIdCard(rnd, personalCity, hireDate),
          entity: ent.code,
          dept: dept,
          title: title,
          grade: grade,
          hireDate: hireDate,
          regularDate: regularDate,
          leaveDate: leaveDate,
          state: state,
          probation: probation,
          salaryStandard: GRADE_SALARY[grade],
          city: personalCity,
          bankStatus: rnd() < 0.94 ? '已校验' : '待校验',
          bankName: ['招商银行', '中国工商银行', '中国建设银行', '交通银行', '中国银行'][Math.floor(rnd() * 5)],
          bankNo: '6222' + String(Math.floor(rnd() * 1e12)).padStart(12, '0').slice(0, 12),
          profile: rnd() < 0.97 ? '完整' : '缺项'
        });
      }
    });
    return out;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function addMonths(ymd, n) {
    var p = ymd.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1 + n, p[2]);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function genIdCard(rnd, city, hireDate) {
    var pref = { '上海': '310104', '北京': '110105', '深圳': '440305' }[city] || '310104';
    var y = 1978 + Math.floor(rnd() * 22);
    return pref + y + '****' + String(1000 + Math.floor(rnd() * 8999)).slice(1);
  }
  function maskId(v) { return v ? v.slice(0, 6) + '********' + v.slice(-4) : '—'; }
  function maskBank(v) { return v ? v.slice(0, 4) + ' **** **** ' + v.slice(-4) : '—'; }

  var EMPLOYEES = buildEmployees();
  var EMP_BY_ID = {};
  EMPLOYEES.forEach(function (e) { EMP_BY_ID[e.id] = e; });

  /* 上海主体的两条绩效系数异常记录（缺失、负数，可通过导入纠错修复）
     对应绩效导入文件的第 38、59 行（表头占第 1 行） */
  var PERF_MISSING_IDS = ['EMP037', 'EMP058'];
  /* 导入文件中无法匹配的员工行（孤立行） */
  var ORPHAN_ROW_IDCARD = '3101041991****7731';

  function perfMissingOn() { return !state().perfFixed; }
  function perfMissingSet() {
    var set = {};
    if (perfMissingOn()) PERF_MISSING_IDS.forEach(function (id) { set[id] = 1; });
    return set;
  }

  /* ══ 4. 考勤与绩效输入（按期间确定性生成） ═════════════════ */
  var _attCache = {};
  function attendance(emp, period) {
    var key = emp.id + '@' + period;
    if (_attCache[key]) return _attCache[key];
    var rnd = mulberry32(seedOf('att' + key));
    var a;
    if (emp.state === '离职' && emp.leaveDate && emp.leaveDate.slice(0, 7) === period) {
      a = { hasRecord: true, lateMin: 0, earlyMin: 0, missPunch: 0, leaveType: '无', leaveDays: 0, remark: '本期离职，按实际计薪天数折算' };
    } else if (emp.hireDate.slice(0, 7) === period) {
      a = { hasRecord: true, lateMin: 0, earlyMin: 0, missPunch: 0, leaveType: '无', leaveDays: 0, remark: '本期入职，按实际计薪天数折算' };
    } else if (rnd() < 0.035) {
      a = { hasRecord: false, lateMin: 0, earlyMin: 0, missPunch: 0, leaveType: '无', leaveDays: 0, remark: '本期无考勤记录' };
    } else {
      var lr = rnd();
      var late = lr < 0.10 ? 1 + Math.floor(rnd() * 45) : 0;
      var early = rnd() < 0.07 ? 1 + Math.floor(rnd() * 30) : 0;
      var miss = rnd() < 0.06 ? 1 + Math.floor(rnd() * 2) : 0;
      var lv = '无', ld = 0;
      var t = rnd();
      if (t < 0.12) { lv = '有薪'; ld = 1 + Math.floor(rnd() * 3); }
      else if (t < 0.20) { lv = '无薪'; ld = 1 + Math.floor(rnd() * 2); }
      a = { hasRecord: true, lateMin: late, earlyMin: early, missPunch: miss, leaveType: lv, leaveDays: ld, remark: '' };
    }
    _attCache[key] = a;
    return a;
  }

  var _coefCache = {};
  function coefficient(emp, period) {
    var key = emp.id + '@' + period;
    if (_coefCache[key] != null) return _coefCache[key];
    var rnd = mulberry32(seedOf('perf' + key));
    var v = Math.round((0.60 + Math.floor(rnd() * 13) * 0.05) * 100) / 100;
    _coefCache[key] = v;
    return v;
  }

  /* ══ 5. 规则引擎 ═══════════════════════════════════════════ */
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function cityRule(city, period) {
    var vs = ruleVersions(city), p = period + '-01';
    for (var i = 0; i < vs.length; i++) {
      if (vs[i].validFrom <= p && vs[i].validTo >= p) return vs[i];
    }
    return null;
  }
  /* 命中指定期间的版本；无适用版本时回退到最新版本用于展示 */
  function ruleFor(city, period) { return cityRule(city, period) || ruleVersions(city)[0] || null; }
  function personalRate(city) { return ruleVersions(city)[0].personal.reduce(function (s, x) { return s + x.r; }, 0); }
  function companyRate(city) { return ruleVersions(city)[0].company.reduce(function (s, x) { return s + x.r; }, 0); }

  function workedDays(emp, period) {
    var d = STD_DAYS;
    if (emp.hireDate.slice(0, 7) === period) d = Math.max(0, STD_DAYS - (Number(emp.hireDate.slice(8, 10)) - 1));
    if (emp.leaveDate && emp.leaveDate.slice(0, 7) === period) d = Math.min(d, Number(emp.leaveDate.slice(8, 10)));
    return d;
  }

  /* 单名员工在指定期间的计算结果 */
  function computeOne(emp, period, opt) {
    opt = opt || {};
    var rule = cityRule(emp.city, period);
    var invalid = [];
    if (!rule) invalid.push('缺有效城市规则（' + emp.city + '）');
    if (opt.perfMissing) invalid.push(emp.id === 'EMP058' ? '绩效系数不能为负数' : '缺绩效系数');

    var std = emp.salaryStandard;
    var fixedFull = round2(std * 0.8);
    var perfBase = round2(std * 0.2);
    var days = workedDays(emp, period);
    var fixed = round2(fixedFull * days / STD_DAYS);

    var regularInPeriod = emp.regularDate && emp.regularDate.slice(0, 7) === period;
    var isRegular = !emp.probation || regularInPeriod;
    var coef = opt.perfMissing ? null : coefficient(emp, period);
    var perfAmount = (isRegular && coef != null) ? round2(perfBase * coef) : 0;

    var att = attendance(emp, period);
    var penalized = emp.grade !== 'P7' && emp.grade !== 'P8';
    var perMin = fixedFull / STD_DAYS / STD_HOURS / 60;
    var attDeduct = 0, unpaidLeaveDeduct = 0;
    if (penalized) {
      attDeduct = round2((att.lateMin + att.earlyMin) * perMin + att.missPunch * 30);
      if (att.leaveType === '无薪') unpaidLeaveDeduct = round2(fixedFull / STD_DAYS * att.leaveDays);
    }
    var attTotal = round2(attDeduct + unpaidLeaveDeduct);

    var siBase = rule ? rule.base : 0;
    var pSI = rule ? round2(siBase * personalRate(emp.city)) : 0;
    var cSI = rule ? round2(siBase * companyRate(emp.city)) : 0;
    var pHF = round2(fixedFull * HF_RATE);
    var cHF = round2(fixedFull * HF_RATE);

    var gross = round2(fixed + perfAmount - attTotal);
    var net = round2(gross - pSI - pHF);
    var cost = round2(gross + cSI + cHF);

    return {
      emp: emp, period: period, ok: invalid.length === 0, invalid: invalid,
      days: days, fixedFull: fixedFull, perfBase: perfBase, fixed: fixed,
      isRegular: isRegular, regularInPeriod: regularInPeriod, coef: coef, perfAmount: perfAmount,
      att: att, attDeduct: attDeduct, unpaidLeaveDeduct: unpaidLeaveDeduct, attTotal: attTotal,
      penalized: penalized, siBase: siBase,
      pSI: pSI, cSI: cSI, pHF: pHF, cHF: cHF,
      pRate: rule ? personalRate(emp.city) : 0, cRate: rule ? companyRate(emp.city) : 0,
      gross: gross, net: net, cost: cost, rule: rule, incentive: 0
    };
  }

  function scope(period, entityCode) {
    return EMPLOYEES.filter(function (e) { return !entityCode || e.entity === entityCode; });
  }

  /* 计算一个主体在指定期间的全部试算结果（未附加激励）。
     绩效系数异常属于本期（2026-08）上海绩效导入的录入问题，
     只影响本期，历史已锁定期间不受影响。 */
  function computeEntity(period, entityCode) {
    var missSet = perfMissingSet();
    var onlySH = entityCode === 'SH01' && period === COMPANY.period;
    return scope(period, entityCode).map(function (e) {
      return computeOne(e, period, { perfMissing: onlySH && missSet[e.id] === 1 });
    });
  }

  /* 全公司考勤激励 */
  var _incCache = {};
  function incentivePlan(period) {
    if (_incCache[period]) return _incCache[period];
    var prev = prevPeriod(period);
    var pool = 0;
    EMPLOYEES.forEach(function (e) {
      var c = computeOne(e, prev, { perfMissing: false });
      pool += c.attTotal;
    });
    pool = round2(pool);
    var all = EMPLOYEES.map(function (e) { return computeOne(e, period, { perfMissing: false }); });
    var ready = ENTITIES.every(function (ent) { return cityRule(ent.city, period) != null; });
    var eligible = all.filter(function (c) { return isEligible(c); });
    var avg = eligible.length ? Math.floor((pool / eligible.length) * 100) / 100 : 0;
    var rem = round2(pool - avg * eligible.length);
    var plan = {
      period: period, prev: prev, pool: pool, ready: ready,
      eligible: eligible, avg: avg, remainder: rem,
      memberIds: eligible.map(function (c) { return c.emp.id; })
    };
    _incCache[period] = plan;
    return plan;
  }
  function isEligible(c) {
    var e = c.emp, a = c.att;
    if (!c.ok) return false;
    if (e.state !== '在职') return false;
    if (!c.isRegular || e.probation) return false;
    if (e.grade === 'P7' || e.grade === 'P8') return false;
    if (!a.hasRecord) return false;
    if (a.lateMin > 0 || a.earlyMin > 0 || a.missPunch > 0) return false;
    if (a.leaveType !== '无') return false;
    return true;
  }
  function excludeReason(c) {
    var e = c.emp, a = c.att;
    if (!c.ok) return c.invalid[0];
    if (e.state !== '在职') return '本期已离职';
    if (!c.isRegular || e.probation) return '试用期未转正';
    if (e.grade === 'P7' || e.grade === 'P8') return e.grade + ' 及以上不参与';
    if (!a.hasRecord) return '本期无考勤记录';
    if (a.lateMin > 0) return '迟到 ' + a.lateMin + ' 分钟';
    if (a.earlyMin > 0) return '早退 ' + a.earlyMin + ' 分钟';
    if (a.missPunch > 0) return '忘打卡 ' + a.missPunch + ' 次';
    if (a.leaveType !== '无') return a.leaveType + '假 ' + a.leaveDays + ' 天';
    return '不符合条件';
  }
  function prevPeriod(p) {
    var y = Number(p.slice(0, 4)), m = Number(p.slice(5, 7));
    m--; if (m === 0) { m = 12; y--; }
    return y + '-' + pad2(m);
  }

  /* 是否已计算本期激励（演示状态） */
  function incentiveDone() { return !!state().incentiveDone; }

  /* 汇总 */
  function summarize(list) {
    var s = { count: list.length, ok: 0, fail: 0, fixed: 0, perf: 0, attDeduct: 0, incentive: 0, pSI: 0, pHF: 0, gross: 0, net: 0, cSI: 0, cHF: 0, cost: 0 };
    list.forEach(function (c) {
      if (c.ok) s.ok++; else s.fail++;
      if (!c.ok) return;
      s.fixed += c.fixed; s.perf += c.perfAmount; s.attDeduct += c.attTotal;
      s.incentive += c.incentive || 0; s.pSI += c.pSI; s.pHF += c.pHF;
      s.gross += c.gross; s.net += c.net; s.cSI += c.cSI; s.cHF += c.cHF; s.cost += c.cost;
    });
    Object.keys(s).forEach(function (k) { if (typeof s[k] === 'number' && k !== 'count' && k !== 'ok' && k !== 'fail') s[k] = round2(s[k]); });
    return s;
  }

  /* 批次 */
  var BATCHES = [
    { no: 'PAY-202608-SH01-V1', period: '2026-08', entity: 'SH01', kind: '正常工资', version: 'V1', count: 96, verify: 'needsFix', state: 'trial', payDate: '2026-09-10' },
    { no: 'PAY-202608-BJ01-V1', period: '2026-08', entity: 'BJ01', kind: '正常工资', version: 'V1', count: 24, verify: 'ready', state: 'trial', payDate: '2026-09-10' },
    { no: 'PAY-202608-SZ01-V1', period: '2026-08', entity: 'SZ01', kind: '正常工资', version: 'V1', count: 8, verify: 'blocked', state: 'prepare', payDate: '2026-09-10' },
    { no: 'PAY-202607-BJ01-V2', period: '2026-07', entity: 'BJ01', kind: '正常工资', version: 'V2', count: 24, verify: 'ready', state: 'locked', payDate: '2026-08-10', correctionOf: 'PAY-202607-BJ01-V1' },
    { no: 'PAY-202607-BJ01-V1', period: '2026-07', entity: 'BJ01', kind: '正常工资', version: 'V1', count: 24, verify: 'ready', state: 'superseded', payDate: '2026-08-10' },
    { no: 'PAY-202607-SH01-V1', period: '2026-07', entity: 'SH01', kind: '正常工资', version: 'V1', count: 96, verify: 'ready', state: 'locked', payDate: '2026-08-10' },
    { no: 'PAY-202607-SZ01-V1', period: '2026-07', entity: 'SZ01', kind: '正常工资', version: 'V1', count: 8, verify: 'ready', state: 'locked', payDate: '2026-08-10' },
    { no: 'PAY-202607-SH01-RE01', period: '2026-07', entity: 'SH01', kind: '独立补发', version: 'V1', count: 2, verify: 'ready', state: 'locked', payDate: '2026-08-10', reason: '2026-07 社保基数补差' }
  ];

  /* 导入批次 */
  var IMPORTS = [
    { id: 'IMP-202608-SH01-001', type: '月度考勤', period: '2026-08', entity: 'SH01', file: '星澜上海_2026-08_考勤.xlsx', tpl: 'TPL-ATT-v3.2', time: '2026-09-01 09:14', total: 96, ok: 96, err: 0, state: 'ok' },
    { id: 'IMP-202608-SH01-002', type: '月度绩效', period: '2026-08', entity: 'SH01', file: '星澜上海_2026-08_绩效.xlsx', tpl: 'TPL-PERF-v2.1', time: '2026-09-01 09:31', total: 96, ok: 93, err: 3, state: 'partial' },
    { id: 'IMP-202608-BJ01-001', type: '月度考勤', period: '2026-08', entity: 'BJ01', file: '星澜北京_2026-08_考勤.xlsx', tpl: 'TPL-ATT-v3.2', time: '2026-09-01 10:02', total: 24, ok: 24, err: 0, state: 'ok' },
    { id: 'IMP-202608-BJ01-002', type: '月度绩效', period: '2026-08', entity: 'BJ01', file: '星澜北京_2026-08_绩效.xlsx', tpl: 'TPL-PERF-v2.1', time: '2026-09-01 10:08', total: 24, ok: 24, err: 0, state: 'ok' },
    { id: 'IMP-202608-SZ01-001', type: '月度考勤', period: '2026-08', entity: 'SZ01', file: '星澜深圳_2026-08_考勤.xlsx', tpl: 'TPL-ATT-v3.2', time: '2026-09-01 11:20', total: 8, ok: 8, err: 0, state: 'ok' },
    { id: 'IMP-202608-SZ01-002', type: '月度绩效', period: '2026-08', entity: 'SZ01', file: '星澜深圳_2026-08_绩效.xlsx', tpl: 'TPL-PERF-v2.1', time: '2026-09-01 11:26', total: 8, ok: 8, err: 0, state: 'ok' },
    { id: 'IMP-202607-SH01-001', type: '月度考勤', period: '2026-07', entity: 'SH01', file: '星澜上海_2026-07_考勤.xlsx', tpl: 'TPL-ATT-v3.1', time: '2026-08-01 09:05', total: 96, ok: 96, err: 0, state: 'ok' }
  ];

  /* 绩效导入的 3 条错误行 */
  function perfErrorRows() {
    var e37 = EMP_BY_ID['EMP037'], e58 = EMP_BY_ID['EMP058'];
    return [
      { row: 38, emp: e37.name + '（' + e37.id + '）', entity: 'SH01', field: '绩效系数', raw: '（空）', reason: '必填值缺失', fix: '补齐非负绩效系数', done: state().perfFixed },
      { row: 59, emp: e58.name + '（' + e58.id + '）', entity: 'SH01', field: '绩效系数', raw: '-0.10', reason: '绩效系数非法（不能为负数）', fix: '修正为非负数', done: state().perfFixed },
      { row: 81, emp: '身份证号 ' + ORPHAN_ROW_IDCARD, entity: 'SH01', field: '身份证号', raw: ORPHAN_ROW_IDCARD, reason: '员工无法匹配（不在本期员工名单中）', fix: '确认后忽略该行，或先维护员工资料', done: state().perfFixed }
    ];
  }

  /* ══ 5.5 叠加考勤激励后的结果（激励不计入社保、公积金基数） ═══ */
  /* 激励只在当前期间（2026-08）执行过；历史已锁定期间不受影响 */
  function incentiveAmountFor(empId, period) {
    if (!incentiveDone()) return 0;
    if (period !== COMPANY.period) return 0;
    var plan = incentivePlan(period);
    return plan.memberIds.indexOf(empId) >= 0 ? plan.avg : 0;
  }
  function applyIncentive(c, period) {
    if (!c.ok) return c;
    var inc = incentiveAmountFor(c.emp.id, period);
    if (!inc) return c;
    return Object.assign({}, c, {
      incentive: inc,
      gross: round2(c.gross + inc),
      net: round2(c.net + inc),
      cost: round2(c.cost + inc)
    });
  }
  function computeEntityFull(period, entityCode) {
    return computeEntity(period, entityCode).map(function (c) { return applyIncentive(c, period); });
  }
  function computeAll(period) {
    var out = [];
    ENTITIES.forEach(function (e) { out = out.concat(computeEntityFull(period, e.code)); });
    return out;
  }

  /* 2026-07 北京批次：V1 有绩效系数录入错误，V2 为整批更正版本 */
  var BJ_V1_WRONG_COEF = { EMP103: 0.60, EMP111: 0.60 };
  function isWrongCoef(period, entityCode, version, id) {
    return period === '2026-07' && entityCode === 'BJ01' && version === 'V1' && BJ_V1_WRONG_COEF[id] != null;
  }
  function computeEntityVersion(period, entityCode, version) {
    return computeEntity(period, entityCode).map(function (c) {
      if (!c.ok || !isWrongCoef(period, entityCode, version, c.emp.id)) return c;
      var w = BJ_V1_WRONG_COEF[c.emp.id];
      var perf = round2(c.perfBase * w);
      var gross = round2(c.fixed + perf - c.attTotal);
      return Object.assign({}, c, {
        coef: w, perfAmount: perf, gross: gross,
        net: round2(gross - c.pSI - c.pHF),
        cost: round2(gross + c.cSI + c.cHF),
        wrong: true
      });
    });
  }

  /* ══ 5.6 导出模板与导出历史 ═══════════════════════════════ */
  var EXPORT_TEMPLATES = [
    { code: 'TPL-SALARY', name: '工资表', version: 'v4.1', purpose: '发放用工资明细，逐人列出收入项、扣款项、社保公积金与未扣个税金额。', cols: '员工、主体、部门、固定薪资、绩效、考勤扣款、激励、个人社保、个人公积金、未扣个税金额、公司成本' },
    { code: 'TPL-AGENCY', name: '代发工资表', version: 'v3.0', purpose: '交银行代发使用，只保留收款人与发放金额，不参与核算。', cols: '姓名、开户行、银行卡号、未扣个税金额' },
    { code: 'TPL-COST', name: '人工成本表', version: 'v2.3', purpose: '按主体与部门汇总工资及相关人工成本，不含项目工时。', cols: '主体、部门、人数、应发金额、公司社保、公司公积金、公司成本' },
    { code: 'TPL-TAX', name: '正常工资薪金所得申报辅助模板', version: 'v2026.1', purpose: '个税申报辅助，税额及专项附加扣除留空，由 Excel 侧计算后回填。', cols: '姓名、身份证号、收入额、免税收入、各项扣除、税额（留空）、税款所属期起止（留空）' }
  ];
  /* 税务模板中系统无权填写的字段，导出时留空并写入报告 */
  var TAX_BLANK_FIELDS = ['本期专项附加扣除', '累计专项附加扣除', '税款所属期起止'];

  var EXPORT_HISTORY = [
    { id: 'EXP-202607-004', tpl: '工资表', tplv: 'v4.0', period: '2026-07', scope: '全部主体（3）', entities: 3, count: 128, time: '2026-08-02 14:20', st: 'ok', note: '报告无异常' },
    { id: 'EXP-202607-005', tpl: '代发工资表', tplv: 'v3.0', period: '2026-07', scope: '上海主体', entities: 1, count: 96, time: '2026-08-02 14:12', st: 'ok', note: '报告无异常' },
    { id: 'EXP-202607-006', tpl: '正常工资薪金所得申报辅助模板', tplv: 'v2025.4', period: '2026-07', scope: '全部主体（3）', entities: 3, count: 128, time: '2026-08-02 14:05', st: 'warn', note: '3 项税务字段留空，已写入结果报告' },
    { id: 'EXP-202606-007', tpl: '人工成本表', tplv: 'v2.3', period: '2026-06', scope: '全部主体（3）', entities: 3, count: 128, time: '2026-07-02 11:38', st: 'ok', note: '报告无异常' }
  ];
  function exportHistory() {
    var out = EXPORT_HISTORY.slice();
    if (state().exported) {
      out.unshift({
        id: 'EXP-202608-008', tpl: '工资表', tplv: 'v4.1', period: '2026-08',
        scope: '全部主体（3）· 最新有效批次', entities: 3, count: 128,
        time: '2026-09-02 16:40', st: 'ok', note: '报告无异常', fresh: true
      });
    }
    return out;
  }
  /* 某个导出记录对应的金额合计（按期间用同一套引擎重算，保证跨页一致） */
  function exportSummary(rec) {
    var list = computeAll(rec.period);
    return summarize(list);
  }

  /* ══ 6. 演示状态（localStorage） ═══════════════════════════ */
  var STATE_KEY = 'qsx.demo.v1';
  function state() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function setState(patch) {
    var s = state();
    Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {}
    bustCaches();
    return s;
  }
  function resetState() {
    try { localStorage.removeItem(STATE_KEY); } catch (e) {}
    bustCaches();
  }
  /* 激励计划依赖演示状态（深圳规则是否补齐），状态变化后必须失效重算 */
  function bustCaches() { _incCache = {}; }

  /* 缺有效城市规则的员工（base 城市与主体城市可能不同，需按人判断） */
  function missingRuleEmployees(period) {
    return EMPLOYEES.filter(function (e) { return cityRule(e.city, period) == null; });
  }
  function missingRuleIn(period, entityCode) {
    return missingRuleEmployees(period).filter(function (e) { return e.entity === entityCode; });
  }

  function entityStatus(code) {
    var s = state(), inc = incentiveDone();
    var P = COMPANY.period;
    var bad = missingRuleIn(P, code).length;
    var ruleGap = (!s.szRuleAdded && bad > 0) ? bad : 0;
    if (code === 'SH01') {
      if (!s.perfFixed) return { key: 'blocked', label: '数据准备中', note: '绩效导入 3 行错误待修复' };
      if (ruleGap) return { key: 'blocked', label: '数据准备中', note: ruleGap + ' 名员工 base 深圳，缺有效城市规则' };
      if (!s.recalculated) return { key: 'trial', label: '试算已失效', note: '输入已更新，需重新试算' };
      if (!inc) return { key: 'trial', label: '试算完成', note: '等待全公司考勤激励' };
      return { key: 'ready', label: '全体校验通过', note: '可整批确认' };
    }
    if (code === 'BJ01') {
      if (ruleGap) return { key: 'blocked', label: '数据准备中', note: ruleGap + ' 名员工 base 深圳，缺有效城市规则' };
      if (!inc) return { key: 'trial', label: '试算完成', note: '等待全公司考勤激励' };
      return { key: 'ready', label: '全体校验通过', note: '可整批确认' };
    }
    if (code === 'SZ01') {
      if (!s.szRuleAdded) return { key: 'blocked', label: '数据准备中', note: '深圳社保规则已过期，缺有效城市规则' };
      if (!inc) return { key: 'trial', label: '待试算', note: '城市规则已补齐' };
      return { key: 'ready', label: '全体校验通过', note: '可整批确认' };
    }
    return { key: 'muted', label: '—', note: '' };
  }
  function incentiveReady() {
    var s = state();
    return ENTITIES.every(function (e) {
      if (e.code === 'SZ01') return !!s.szRuleAdded;
      if (e.code === 'SH01') return !!s.perfFixed;
      return true;
    });
  }

  /* ══ 7. 工具函数 ═══════════════════════════════════════════ */
  function money(n, opt) {
    opt = opt || {};
    if (n == null || isNaN(n)) return '—';
    var s = (Math.round(n * 100) / 100).toFixed(2);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.') + (opt.unit ? '' : '');
  }
  function pct(r) { return (r * 100).toFixed(r * 1000 % 10 === 0 ? 0 : 2) + '%'; }
  function ent(code) { for (var i = 0; i < ENTITIES.length; i++) if (ENTITIES[i].code === code) return ENTITIES[i]; return null; }
  function dept(code) { for (var i = 0; i < DEPTS.length; i++) if (DEPTS[i].code === code) return DEPTS[i]; return null; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function q(sel, root) { return (root || document).querySelector(sel); }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  var STATE_META = {
    draft: { label: '草稿', cls: 'is-muted' },
    prepare: { label: '数据准备中', cls: 'is-warn' },
    trial: { label: '试算完成', cls: 'is-info' },
    invalid: { label: '试算已失效', cls: 'is-warn' },
    confirmed: { label: '已确认', cls: 'is-ok' },
    locked: { label: '已锁定', cls: 'is-ok' },
    superseded: { label: '已被新版本替代', cls: 'is-muted' },
    readonly: { label: '只读', cls: 'is-muted' },
    ok: { label: '全部成功', cls: 'is-ok' },
    partial: { label: '部分成功', cls: 'is-warn' },
    failed: { label: '导入失败', cls: 'is-danger' },
    ready: { label: '就绪', cls: 'is-ok' },
    blocked: { label: '阻断', cls: 'is-danger' },
    missing: { label: '缺失', cls: 'is-warn' },
    expired: { label: '已过期', cls: 'is-danger' },
    valid: { label: '生效中', cls: 'is-ok' }
  };
  function badge(key, text) {
    var m = STATE_META[key] || { label: text || key, cls: 'is-muted' };
    return '<span class="badge ' + m.cls + '">' + esc(text || m.label) + '</span>';
  }
  function icon(name) { return ICONS[name] || ICONS.info; }

  /* ══ 8. 外壳渲染 ═══════════════════════════════════════════ */
  var ICONS = {
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    sitemap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="9" y="3" width="6" height="5" rx="1"/><rect x="2" y="16" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M5 16v-2h14v2"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><path d="M16 5.2A3 3 0 0 1 16 11M18 20c0-2.4-.9-4.2-2.4-5.3"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V4M8 8l4-4 4 4"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    calc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="2.5" width="16" height="19" rx="2"/><path d="M8 7h8M8 11.5h3M8 16h3M14.5 11.5h1.5M14.5 16h1.5"/></svg>',
    award: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="9" r="5.5"/><path d="M8.5 13.5 7 21l5-2.5L17 21l-1.5-7.5"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5z"/><path d="M4 17h15M8 3v14"/></svg>',
    building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-4h4v4"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 4v12M8 12l4 4 4-4"/><path d="M4 18v1.5A1.5 1.5 0 0 0 5.5 21h13A1.5 1.5 0 0 0 20 19.5V18"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3.5 21 20H3z"/><path d="M12 9.5v4.5M12 17h.01"/></svg>',
    block: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M6.5 6.5l11 11"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z"/><path d="M14 3v4.5h4.5"/></svg>',
    reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4.5h4.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4.5" y="10" width="15" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 13 5.5 4.5h13L21 13v6a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z"/><path d="M3 13h5l1 2.5h6L16 13h5"/></svg>'
  };

  var NAV = [
    { group: '工作台', items: [{ key: 'workbench', label: '月度工作台', href: 'index.html', icon: 'grid' }] },
    {
      group: '基础资料', items: [
        { key: 'org', label: '组织管理', href: 'organization.html', icon: 'sitemap' },
        { key: 'employees', label: '员工管理', href: 'employees.html', icon: 'users' }
      ]
    },
    { group: '数据导入', items: [{ key: 'import-center', label: '导入中心', href: 'import-center.html', icon: 'upload' }] },
    {
      group: '工资核算', items: [
        { key: 'periods', label: '工资期间与批次', href: 'periods.html', icon: 'calendar' },
        { key: 'batch', label: '批次核算详情', href: 'batch-detail.html', icon: 'calc' },
        { key: 'incentive', label: '全公司考勤激励', href: 'incentive.html', icon: 'award' }
      ]
    },
    { group: '工资台账', items: [{ key: 'ledger', label: '工资台账与汇总', href: 'ledger.html', icon: 'book' }] },
    {
      group: '规则维护', items: [
        { key: 'city-rules', label: '城市社保与公积金规则', href: 'city-rules.html', icon: 'building' },
        { key: 'payroll-rules', label: '考勤与薪酬规则', href: 'payroll-rules.html', icon: 'sliders' }
      ]
    },
    { group: '结果导出', items: [{ key: 'export', label: '导出中心', href: 'export-center.html', icon: 'download' }] }
  ];

  function navBadge(key) {
    var s = state();
    if (key === 'workbench') return 6;
    if (key === 'import-center') return s.perfFixed ? 0 : 3;
    if (key === 'batch') return s.perfFixed && s.recalculated && incentiveDone() ? 0 : 1;
    if (key === 'incentive') return incentiveReady() ? (incentiveDone() ? 0 : 1) : 1;
    if (key === 'city-rules') return s.szRuleAdded ? 0 : 1;
    return 0;
  }

  function renderShell() {
    var body = document.body;
    var page = body.getAttribute('data-page') || '';
    var crumb = (body.getAttribute('data-crumb') || '').split('/').map(function (s) { return s.trim(); }).filter(Boolean);
    var title = body.getAttribute('data-title') || '';

    var sb = q('#sidebar');
    if (sb) {
      var h = '<div class="brand"><div class="brand-mark"><span class="brand-logo">薪</span>' +
        '<div class="brand-text"><div class="brand-name">轻算薪</div></div></div>' +
        '<div class="brand-org">' + ICONS.building + '<span>' + esc(COMPANY.name) + '</span></div>' +
        '<div class="brand-sub">工资计算与核对 · 本地运行 · 未扣个税结果</div></div><nav class="sidebar-nav">';
      NAV.forEach(function (g) {
        h += '<div class="nav-group"><div class="nav-group-title">' + esc(g.group) + '</div>';
        g.items.forEach(function (it) {
          var n = navBadge(it.key);
          h += '<a class="nav-item' + (it.key === page ? ' is-active' : '') + '" href="' + it.href +
            '" data-od-id="nav-' + it.key + '">' + ICONS[it.icon] + '<span>' + esc(it.label) + '</span>' +
            (n > 0 ? '<span class="nav-badge">' + n + '</span>' : '') + '</a>';
        });
        h += '</div>';
      });
      h += '</nav>';
      sb.innerHTML = h;
    }

    var tb = q('#topbar');
    if (tb) {
      var scope = body.getAttribute('data-scope');
      var h2 = '<div class="crumb">';
      crumb.forEach(function (c, i) {
        h2 += (i ? '<span class="sep">/</span>' : '') +
          '<span class="' + (i === crumb.length - 1 ? 'current' : 'trail') + '">' + esc(c) + '</span>';
      });
      h2 += '</div>';
      if (title) h2 += '<div class="topbar-title">' + esc(title) + '</div>';
      h2 += '<div class="spacer"></div><div class="topbar-actions">';
      if (scope === 'payroll') {
        h2 += '<label class="row small muted" style="gap:6px">工资期间' +
          '<select class="select" style="width:118px" data-od-id="topbar-period">' +
          PERIODS.map(function (p) { return '<option value="' + p.code + '"' + (p.code === COMPANY.period ? ' selected' : '') + '>' + p.label + '</option>'; }).join('') +
          '</select></label>' +
          '<label class="row small muted" style="gap:6px">主体' +
          '<select class="select" style="width:150px" data-od-id="topbar-entity">' +
          '<option value="">全部主体（3）</option>' +
          ENTITIES.map(function (e) { return '<option value="' + e.code + '">' + e.short + ' · ' + e.headcount + ' 人</option>'; }).join('') +
          '</select></label>';
      }
      h2 += '<button class="icon-btn" type="button" title="重置演示数据" data-od-id="reset-demo">' + ICONS.reset + '</button>';
      h2 += '</div>';
      tb.innerHTML = h2;
    }

    var f = q('.pagefoot');
    if (f) f.innerHTML = '<span>轻算薪 · 本地原型 · 演示数据，非真实企业与薪资</span><span>系统金额均为「未扣个税金额」，个税请在导出后于 Excel 中手工计算并核对</span>';
  }

  /* ══ 9. 交互 ═══════════════════════════════════════════════ */
  function openOverlay(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('is-open');
  }
  function closeOverlay(el) {
    var o = typeof el === 'string' ? document.getElementById(el) : el;
    if (o) o.classList.remove('is-open');
  }
  function closeAll() { qa('.overlay.is-open').forEach(function (o) { o.classList.remove('is-open'); }); }

  function toast(msg, kind) {
    var host = q('.toast-host');
    if (!host) { host = document.createElement('div'); host.className = 'toast-host'; document.body.appendChild(host); }
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' is-' + kind : '');
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; t.style.transition = 'opacity .2s'; }, 2600);
    setTimeout(function () { t.remove(); }, 2900);
  }

  function wire() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-open]');
      if (t) { e.preventDefault(); openOverlay(t.getAttribute('data-open')); }

      var c = e.target.closest('[data-close]');
      if (c) { e.preventDefault(); closeOverlay(c.closest('.overlay')); }

      if (e.target.classList && e.target.classList.contains('overlay') &&
          e.target.getAttribute('data-static') !== 'true') closeAll();

      var tab = e.target.closest('[data-tab]');
      if (tab) {
        var group = tab.closest('[data-tabs]');
        var name = tab.getAttribute('data-tab');
        qa('[data-tab]', group).forEach(function (b) { b.classList.toggle('is-on', b === tab); });
        var host = group.getAttribute('data-tabs');
        qa('[data-tabpanel]').forEach(function (p) {
          if (p.getAttribute('data-tabgroup') === host) p.classList.toggle('is-on', p.getAttribute('data-tabpanel') === name);
        });
      }

      var seg = e.target.closest('.seg button');
      if (seg) {
        qa('button', seg.parentElement).forEach(function (b) { b.classList.toggle('is-on', b === seg); });
        var target = seg.getAttribute('data-view');
        if (target) {
          qa('[data-viewpanel]').forEach(function (p) { p.classList.toggle('is-on', p.getAttribute('data-viewpanel') === target); });
        }
      }

      var rst = e.target.closest('[data-od-id="reset-demo"]');
      if (rst) { resetState(); toast('演示数据已重置', 'ok'); setTimeout(function () { location.reload(); }, 500); }

      var tst = e.target.closest('[data-toast]');
      if (tst) { e.preventDefault(); toast(tst.getAttribute('data-toast'), tst.getAttribute('data-toast-kind') || ''); }

      var dis = e.target.closest('[data-disabled-reason]');
      if (dis && dis.hasAttribute('disabled')) {
        toast(dis.getAttribute('data-disabled-reason'), 'warn');
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAll();
    });
  }

  /* ══ 10. 导出 ══════════════════════════════════════════════ */
  window.QSX = {
    COMPANY: COMPANY, ENTITIES: ENTITIES, DEPTS: DEPTS, ENTITY_DEPTS: ENTITY_DEPTS,
    GRADES: GRADES, GRADE_NAME: GRADE_NAME, GRADE_SALARY: GRADE_SALARY,
    CITY_RULES: CITY_RULES, SZ_RULE_2026: SZ_RULE_2026, ruleVersions: ruleVersions, ruleFor: ruleFor,
    HF_RATE: HF_RATE, STD_DAYS: STD_DAYS, STD_HOURS: STD_HOURS,
    PERIODS: PERIODS, BATCHES: BATCHES, IMPORTS: IMPORTS, EMPLOYEES: EMPLOYEES,
    ICONS: ICONS,
    state: state, setState: setState, resetState: resetState,
    entityStatus: entityStatus, incentiveReady: incentiveReady, incentiveDone: incentiveDone,
    missingRuleEmployees: missingRuleEmployees, missingRuleIn: missingRuleIn,
    perfMissingSet: perfMissingSet, perfMissingOn: perfMissingOn, perfErrorRows: perfErrorRows,
    computeOne: computeOne, computeEntity: computeEntity, computeEntityFull: computeEntityFull,
    computeAll: computeAll, computeEntityVersion: computeEntityVersion,
    applyIncentive: applyIncentive, incentiveAmountFor: incentiveAmountFor,
    EXPORT_TEMPLATES: EXPORT_TEMPLATES, TAX_BLANK_FIELDS: TAX_BLANK_FIELDS,
    exportHistory: exportHistory, exportSummary: exportSummary,
    summarize: summarize,
    incentivePlan: incentivePlan, isEligible: isEligible, excludeReason: excludeReason,
    attendance: attendance, coefficient: coefficient, cityRule: cityRule,
    personalRate: personalRate, companyRate: companyRate, workedDays: workedDays,
    scope: scope, ent: ent, dept: dept, prevPeriod: prevPeriod,
    money: money, pct: pct, esc: esc, q: q, qa: qa, badge: badge, icon: icon,
    openOverlay: openOverlay, closeOverlay: closeOverlay, closeAll: closeAll, toast: toast,
    round2: round2, maskId: maskId, maskBank: maskBank
  };

  document.addEventListener('DOMContentLoaded', function () {
    qa('[data-icon]').forEach(function (el) { el.innerHTML = icon(el.getAttribute('data-icon')); });
    renderShell();
    wire();
  });
})();
