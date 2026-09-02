import sys
import json
import pandas as pd
import pyreadstat

def main():
    # Data comes in as a JSON string via command-line argument
    raw_data = sys.argv[1]
    output_path = sys.argv[2]

    records = json.loads(raw_data)
    df = pd.DataFrame(records)

    # SPSS column names can't have spaces or special characters —
    # normalize them to be safe (e.g. "Form Name" -> "form_name")
    df.columns = [c.strip().lower().replace(' ', '_') for c in df.columns]

    pyreadstat.write_sav(df, output_path)

if __name__ == '__main__':
    main()