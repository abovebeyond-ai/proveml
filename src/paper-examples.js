export const educationFactStore = {
    'class:204.name': '3MA',
    'class:204.studentCount': 22,
    'class:204.passRate': 43,
    'class:204.evalRate': 38,

    'student:1087.name': 'Emma Vos',
    'student:1087.passed': 2,
    'student:1087.evaluated': 31,
    'student:1087.passRate': 6,
    'student:1087.absent': 47,

    'student:1092.name': 'Sander De Witt',
    'student:1092.passRate': 78,
    'student:1092.evaluated': 41,
    'student:1092.diffVs1087': 72,
    'student:1092._diff': 72,
};

export const paperExampleSources = {
    verifyCorrect: `@[class:204]{3MA} has %[studentCount]{22} students with a pass rate of %[passRate]{43}%. ?[below: IS_BELOW_HALF]{This is below the passing threshold}. Only %[evalRate]{38}% of attainment levels have been evaluated, so ?[coverage: IS_LOW_COVERAGE]{coverage is low}.

@[student:1087]{Emma Vos} has passed %[passed]{2} of %[evaluated]{31} evaluated attainment levels (%[passRate]{6}%). ?[low: IS_LOW_PASS]{This is a critically low result}. With %[absent]{47} absences, ?[abs: IS_GREY_RISK]{there is a risk of grey status}. ?[combined: @low AND @abs]{The combination of low results and high absence is notable}.

@[student:1092]{Sander De Witt} has a pass rate of %[passRate]{78}% across %[evaluated]{41} evaluated attainment levels. ?[strong: IS_STRONG]{This is a strong result}. The gap of %[diffVs1087]{72} percentage points is ?[gap: IS_MUCH_HIGHER(student:1092._diff)]{much higher} than @[student:1087]{Emma Vos}.`,

    verifySuggestions: `@[class:204]{3MA} has %[studentCount]{22} students with a pass rate of %[passRate]{43}%. ?[below: IS_BELOW_HALF]{This is below the passing threshold}.

@[student:1087]{Emma Vos} has a pass rate of %[passRate]{6}% with %[absent]{47} absences. ?[low: IS_LOW_PASS]{This is a critically low result}. ?[abs: IS_GREY_RISK]{There is a risk of grey status}.`,

    verifySuggestionsPlain: `This may warrant further investigation by the class teacher. You might want to look into the individual attainment levels to identify specific gaps.`,

    verifyErrors: `%[passRate]{82}% pass rate is strong.

@[class:204]{3MA} has %[studentCount]{24} students with a pass rate of %[passRate]{43}%. ?[below: IS_BELOW_HALF]{This is below the passing threshold}.

@[student:1087]{Emma Vos} has passed %[passed]{2} of %[evaluated]{31} evaluated attainment levels (%[passRate]{16}%). ?[strong: IS_STRONG]{This is a strong result}. With %[absent]{47} absences, ?[abs: IS_GREY_RISK]{there is a risk of grey status}.

@[student:9999]{Thomas Berg} has %[absent]{12} absences.`,
};
