import argparse
import pandas as pd
import xgboost as xgb
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_squared_error, mean_absolute_error
import joblib

# Argument parser for passing datasetId
parser = argparse.ArgumentParser(description="Retrain models based on new data")
parser.add_argument('--datasetId', type=str, help="Dataset ID", required=True)
args = parser.parse_args()

# Function to load data from the database (make sure to use the correct database connection)
def load_data(dataset_id):
    # Placeholder for your database connection code to fetch data based on dataset_id
    # For example, using pandas to read from a CSV or database
    data = pd.read_csv(f"data/dataset_{dataset_id}.csv")
    return data

# Function to preprocess the data
def preprocess_data(data):
    # Apply necessary preprocessing steps: scaling, encoding, etc.
    # Example:
    data['date'] = pd.to_datetime(data['date'])
    data = data.dropna()  # Handle missing values
    return data

# Function to train Random Forest model
def train_random_forest(X_train, y_train):
    rf = RandomForestRegressor(n_estimators=100, random_state=42)
    rf.fit(X_train, y_train)
    return rf

# Function to train XGBoost model
def train_xgboost(X_train, y_train):
    model = xgb.XGBRegressor(objective='reg:squarederror', random_state=42)
    model.fit(X_train, y_train)
    return model

# Function to evaluate the model performance
def evaluate_model(model, X_test, y_test):
    y_pred = model.predict(X_test)
    mse = mean_squared_error(y_test, y_pred)
    rmse = mean_squared_error(y_test, y_pred, squared=False)
    mae = mean_absolute_error(y_test, y_pred)
    print(f"MSE: {mse}, RMSE: {rmse}, MAE: {mae}")
    return mse, rmse, mae

# Main function to retrain models
def retrain_models(dataset_id):
    # Load dataset
    data = load_data(dataset_id)
    
    # Preprocess data
    data = preprocess_data(data)

    # Feature selection and target variable (Assuming target column is 'target')
    X = data.drop(columns=['target'])  # Features
    y = data['target']  # Target

    # Split data into training and testing sets (e.g., 80% train, 20% test)
    from sklearn.model_selection import train_test_split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    # Train Random Forest model
    rf_model = train_random_forest(X_train, y_train)
    rf_mse, rf_rmse, rf_mae = evaluate_model(rf_model, X_test, y_test)

    # Train XGBoost model
    xgb_model = train_xgboost(X_train, y_train)
    xgb_mse, xgb_rmse, xgb_mae = evaluate_model(xgb_model, X_test, y_test)

    # Save models
    joblib.dump(rf_model, f"models/rf_model_{dataset_id}.joblib")
    joblib.dump(xgb_model, f"models/xgb_model_{dataset_id}.joblib")

    # Print evaluation results
    print(f"Random Forest Model: MSE={rf_mse}, RMSE={rf_rmse}, MAE={rf_mae}")
    print(f"XGBoost Model: MSE={xgb_mse}, RMSE={xgb_rmse}, MAE={xgb_mae}")

if __name__ == '__main__':
    retrain_models(args.datasetId)