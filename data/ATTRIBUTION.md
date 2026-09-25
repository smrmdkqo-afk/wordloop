# Wordloop 단어장 출처와 이용 조건

## 2026년 9월 확장팩

`expansion-beginner.json`, `expansion-intermediate.json`, `expansion-advanced.json`은
기존 단어와 철자가 겹치지 않는 단어 3,000개를 추가합니다. 각 항목에는 뜻 1개,
한국어 힌트, 영어 예문 2개, 오답 후보 6개가 들어 있습니다.

영어 설명 일부는 **Princeton WordNet 3.0**을 편집한 것입니다.
해당 항목의 `source`에 원본 synset 번호를 기록했습니다. 직접 작성하거나 뜻을
다시 구성한 영어 설명에는 `wordloop-authored`를 표시했습니다. 이 표시는 영어
설명의 출처이며, 한국어 힌트의 별도 출처도 아래 조건을 따릅니다.

한국어 힌트의 기초 자료는 **Open Multilingual Wordnet의 Wiktionary 한국어 자료**입니다.
Wiktionary 기여자들의 번역 중 사용할 항목을 골라 잘못된 연결, 어색한 표현,
품사 불일치를 교정했습니다. 별도로 작성한 단어·힌트도 포함합니다.

모든 추가 예문은 Wordloop용으로 작성했습니다. 동사·형용사·부사는 뜻과 문법에
맞춘 문장을 사용하며, 명사에는 신체·동물·식물·음식·도구 등 의미 분야에 맞는
**공통 문장 틀을 사용한 예문**이 포함됩니다. 따라서 6,000개는 항목에 수록된
예문의 수이고, 서로 다른 문장 틀 6,000개라는 뜻은 아닙니다.

### 원본 자료

- Princeton University, **WordNet 3.0**: https://wordnet.princeton.edu/
- 사용한 WordNet 배포본: https://github.com/nltk/nltk_data/blob/gh-pages/packages/corpora/wordnet.zip
- Open Multilingual Wordnet: https://omwn.org/
- Wiktionary 기여자 / OMW 한국어 대응 자료: https://github.com/omwn/omw-data/blob/main/wns/wikt/wn-wikt-kor.tab
- 한국어 원본 이용 조건: https://github.com/omwn/omw-data/blob/main/wns/wikt/LICENSE
- 난이도 편집 시 참고한 빈도 자료: https://github.com/hermitdave/FrequencyWords/tree/master/content/2018/en

자료를 확인하고 편집한 날짜: 2026-09-25.

### 재사용

확장팩의 편집·추가 내용과 한국어 힌트는 **Creative Commons Attribution-ShareAlike
3.0 Unported** 조건으로 제공합니다. 재배포할 때 Wordloop, Princeton WordNet,
Open Multilingual Wordnet 및 Wiktionary 기여자를 표시하고 변경 사실과 이 문서를
함께 보존해 주세요.

- CC BY-SA 3.0: https://creativecommons.org/licenses/by-sa/3.0/
- WordNet의 원본 데이터에는 별도의 [WordNet 이용 조건](LICENSE-WordNet.txt)이 적용됩니다.
- 한국어 원본의 [Wiktionary 이용 조건](LICENSE-Wiktionary.txt)도 함께 보존합니다.

이 조건은 확장팩 데이터에 관한 것이며 앱 코드 전체의 라이선스를 변경하지 않습니다.

## 난이도에 관하여

난이도는 공식 CEFR 판정이나 시험 점수에 따른 등급이 아닙니다. 확장팩은 공개
영어 빈도 자료를 초기 참고값으로 사용하고 일상 어휘와 특정 용법을 편집해
초급·중급·고급으로 구분했습니다. 빈도 순위 3,000 이내는 초급, 12,000 이내는
중급, 그 밖은 고급을 출발점으로 삼되, 일상 사물·기초 표현은 조정하고 일부
부차적인 뜻은 한 단계 올렸습니다. 빈도는 뜻별 난이도를 보장하지 않습니다.

기존 1,200개 뜻의 ID·난이도·내용은 이번 추가 작업에서 변경하지 않았습니다.
난이도와 예문의 자연스러움은 이후 편집으로 계속 다듬을 수 있습니다.
