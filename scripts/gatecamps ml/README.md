# Zcamp ML

Train a new model: python -m src.main train data/raw_killmails.json --model-version=1.0.0

Run labeling: python -m src.main label data/killmails_to_label.json
bash

- Takes formatted output from the server uploaded to google drive.
- Downloads the formatted output and feeds it into the training engine
- Runs UI to label each output, confirming that the model is right or wrong
- Model incorporates T/F weight and retrains
- Final output weights are exported to a file
- The trained/refined model is uploaded to the server and used to process real time killmails into gate camp groups

