#
# Copyright 2016 Crown Copyright
#
# Licensed under the Apache License, Version 2.0 (the 'License');
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an 'AS IS' BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

import json
import unittest

from gafferpy import gaffer as g


class GafferFunctionsTest(unittest.TestCase):
    examples = [
        [
            '''
            {
                "class" : "uk.gov.gchq.koryphe.impl.function.Concat",
                "separator" : "\u0020"
            }
            ''',
            g.Concat(
                separator=" "
            )
        ],
        [
            '''
            {
                "class" : "uk.gov.gchq.koryphe.impl.function.Divide"
            }
            ''',
            g.Divide()
        ],
        [
            '''
            {
                "class" : "uk.gov.gchq.koryphe.impl.function.DivideBy",
                "by" : 3
            }
            ''',
            g.DivideBy(
                by=3
            )
        ],
        [
            '''
            {
                "class" : "uk.gov.gchq.koryphe.impl.function.ExtractKeys"
            }
            ''',
            g.ExtractKeys()
        ],
        [
            '''
            {
                "class" : "uk.gov.gchq.koryphe.impl.function.ExtractValues"
            }
            ''',
            g.ExtractValues()
        ],
        [
            '''
            {
                "class" : "uk.gov.gchq.koryphe.impl.function.Identity"
            }
            ''',
            g.Identity()
        ],
        [
            '''
            {
                "class" : "uk.gov.gchq.koryphe.impl.function.IsEmpty"
            }
            ''',
            g.IsEmpty()
        ],
        [
            '''
            {
                "class" : "uk.gov.gchq.koryphe.impl.function.IterableConcat"
            }
            ''',
            g.IterableConcat()
        ],
        [
            '''
            {
                "class" : "uk.gov.gchq.koryphe.impl.function.Multiply"
            }
            ''',
            g.Multiply()
        ],
        [
            '''
            {
                "class" : "uk.gov.gchq.koryphe.impl.function.MultiplyBy",
                "by" : 4
            }
            ''',
            g.MultiplyBy(
                by=4
            )
        ],
        [
            '''
            {
                "class" : "uk.gov.gchq.koryphe.impl.function.Size"
            }
            ''',
            g.Size()
        ],
        [
            '''
            {
                "class" : "uk.gov.gchq.koryphe.impl.function.ToString"
            }
            ''',
            g.ToString()
        ],
        [
            '''
            {
              "class" : "uk.gov.gchq.gaffer.data.generator.MapGenerator",
              "fields" : {
                "GROUP" : "Group Label",
                "VERTEX" : "Vertex Label",
                "SOURCE" : "Source Label",
                "count" : "Count Label"
              },
              "constants" : {
                "A Constant" : "Some constant value"
              }
            }
            ''',
            g.MapGenerator(
                fields={
                    'VERTEX': 'Vertex Label',
                    'count': 'Count Label',
                    'GROUP': 'Group Label',
                    'SOURCE': 'Source Label'
                },
                constants={
                    'A Constant': 'Some constant value'
                }
            )
        ],
        [
            '''
            {
              "class" : "uk.gov.gchq.gaffer.data.generator.CsvGenerator",
              "fields" : {
                "GROUP" : "Group Label",
                "VERTEX" : "Vertex Label",
                "SOURCE" : "Source Label",
                "count" : "Count Label"
              },
              "constants" : {
                "A Constant" : "Some constant value"
              },
              "quoted" : true,
              "commaReplacement": "-"
            }
            ''',
            g.CsvGenerator(
                fields={
                    'VERTEX': 'Vertex Label',
                    'count': 'Count Label',
                    'GROUP': 'Group Label',
                    'SOURCE': 'Source Label'
                },
                constants={
                    'A Constant': 'Some constant value'
                },
                quoted=True,
                comma_replacement="-"
            )
        ],
        [
            '''
            {
              "class" : "uk.gov.gchq.gaffer.types.function.FreqMapExtractor",
              "key" : "key1"
            }
            ''',
            g.FreqMapExtractor(key="key1")
        ],
        [
            '''
            {
              "class" : "uk.gov.gchq.koryphe.function.FunctionMap",
              "function" : {
                "class" : "uk.gov.gchq.koryphe.impl.function.MultiplyBy",
                "by" : 10
              }
            }
            ''',
            g.FunctionMap(
                function=g.MultiplyBy(by=10)
            )
        ]
    ]

    def test_examples(self):
        for example in self.examples:
            self.assertEqual(
                json.loads(example[0]),
                example[1].to_json(),
                "json failed: \n" + example[0] + "\n"
                + g.JsonConverter.from_json(example[0]).to_code_string()
            )
            g.JsonConverter.from_json(example[0], validate=True)


if __name__ == "__main__":
    unittest.main()
