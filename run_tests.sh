#!/bin/bash

## Define text color codes
GREEN='\033[0;32m'  # Green text
BLUE='\033[0;34m'   # Blue text
RED='\033[0;31m'    # Red text
NC='\033[0m'        # No color (reset)

errors=1
totalRuns=0
start_time=$(date +%s)

# either test the converter or the compounder, based on input
if [ "$1" == "converter" ]; then
  test_file="./test/automator-autoconverter.test.ts"
else
  test_file="./test/automator.test.ts"
fi

# caffeinate to prevent display sleep -- macOS specific
caffeinate -d -i -s -w $$ &

while [ $errors -ne 0 ]; do
  errors=0
    if ! yarn test "$test_file"; then
      echo -e "${RED}Test $((totalRuns + 1)) ran with errors.${NC}"
      errors=1
      end_time=$(date +%s)
      elapsed_time=$((end_time - start_time))
      echo -e "${RED}Time elapsed: $elapsed_time seconds${NC}"
    fi
    totalRuns=$((totalRuns + 1))
done
end_time=$(date +%s)
elapsed_time=$((end_time - start_time))

echo -e "${GREEN}All tests ran successfully after $totalRuns runs.${NC}"
echo -e "${BLUE}Total time taken: $elapsed_time seconds${NC}"

# stop the caffeinate command
kill %1
